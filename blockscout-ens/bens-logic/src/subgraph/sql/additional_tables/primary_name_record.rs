// SPDX-License-Identifier: LicenseRef-Blockscout

use crate::{
    entity::subgraph::domain::DomainWithAddress,
    protocols::Protocol,
    subgraph::sql::{utils, DbErr, DOMAIN_BLOCK_RANGE_WHERE_CLAUSE},
};
use nonempty::NonEmpty;
use sea_query::{Alias, Expr, PostgresQueryBuilder};
use sqlx::PgPool;

pub struct PrimaryNameRecordTable;

impl PrimaryNameRecordTable {
    fn table_name() -> &'static str {
        "primary_name_record"
    }
}

impl PrimaryNameRecordTable {
    pub async fn batch_search_addresses(
        pool: &PgPool,
        protocols: &NonEmpty<&Protocol>,
        address: &[impl AsRef<str>],
    ) -> Result<Vec<DomainWithAddress>, DbErr> {
        let table_name = Self::table_name();
        let queries = NonEmpty::collect(protocols.into_iter().map(|p| {
            let schema = &p.subgraph_schema;
            // The selected name is a primary name only while it is active and
            // still resolves to the address. Subgraphs cannot record expiry,
            // which emits no event, so it is checked here; see
            // `DOMAIN_NOT_EXPIRED_WHERE_CLAUSE` for the clamp.
            sea_query::Query::select()
                .expr(Expr::cust("domain_id as id"))
                .expr(Expr::cust("domain_name"))
                .expr(Expr::cust("resolved_address"))
                .expr(Expr::cust(format!("'{}' as protocol_slug", p.info.slug)))
                .from((Alias::new(&p.subgraph_schema), Alias::new(table_name)))
                .and_where(Expr::cust("resolved_address = ANY($1)"))
                .and_where(Expr::cust("domain_id is not null"))
                .and_where(Expr::cust("domain_name is not null"))
                .and_where(Expr::cust(DOMAIN_BLOCK_RANGE_WHERE_CLAUSE))
                .and_where(Expr::cust(format!(
                    r#"EXISTS (
                        SELECT 1
                        FROM {schema}.domain AS active_domain
                        WHERE active_domain.id = {schema}.{table_name}.domain_id
                          AND active_domain.resolved_address = {schema}.{table_name}.resolved_address
                          AND active_domain.block_range @> 2147483647
                          AND (
                            active_domain.expiry_date IS NULL
                            OR to_timestamp(LEAST(active_domain.expiry_date, 253402300799)) > now()
                          )
                    )"#
                )))
                .to_owned()
        }))
        .expect("protocols is nonempty");
        let sql = utils::union_domain_queries(queries, None, None)?.to_string(PostgresQueryBuilder);
        let domains = sqlx::query_as(&sql)
            .bind(utils::bind_string_list(address))
            .fetch_all(pool)
            .await?;
        Ok(domains)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;
    use sqlx::Executor;

    const VITALIK: &str = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const VITALIK_ETH: &str = "0xee6c4522aab0003e8d14cd40a6af439055fd2577951148c14b6cea9a53475835";
    const EXPIRED_OWNER: &str = "0x9f7f7ddbfb8e14d1756580ba8037530da0880b99";
    const EXPIRED_ETH: &str = "0x86f0774249ae1b7dcb5873ac0ada288d09ec4b3bf8bbf672b67726793797142e";
    const TEST_ETH: &str = "0xeb4f647bea6caa36333c816d7b46fdcb05f9466ecacc140ea8c66faf15b3d9f1";
    const STRANGER: &str = "0x0000000000000000000000000000000000000001";

    async fn primary_names(pool: &PgPool) -> Vec<(String, String)> {
        let protocol = Protocol {
            subgraph_schema: "sgd1".to_string(),
            ..Default::default()
        };
        let protocols = NonEmpty::new(&protocol);
        let mut names: Vec<_> = PrimaryNameRecordTable::batch_search_addresses(
            pool,
            &protocols,
            &[VITALIK, EXPIRED_OWNER, STRANGER],
        )
        .await
        .expect("failed to search primary names")
        .into_iter()
        .map(|d| (d.resolved_address, d.domain_name))
        .collect();
        names.sort();
        names
    }

    #[sqlx::test(migrations = "tests/migrations")]
    async fn returns_only_active_names_resolving_to_the_address(pool: PgPool) {
        pool.execute(
            format!(
                r#"
                CREATE TABLE sgd1.primary_name_record (
                    vid bigserial PRIMARY KEY,
                    block_range int4range NOT NULL,
                    id text NOT NULL,
                    resolved_address text NOT NULL,
                    domain_id text,
                    domain_name text
                );
                INSERT INTO sgd1.primary_name_record
                    (block_range, id, resolved_address, domain_id, domain_name)
                VALUES
                    ('[1,)', '{VITALIK}', '{VITALIK}', '{VITALIK_ETH}', 'vitalik.eth'),
                    -- the name has expired
                    ('[1,)', '{EXPIRED_OWNER}', '{EXPIRED_OWNER}', '{EXPIRED_ETH}', 'expired.eth'),
                    -- the name resolves to another address
                    ('[1,)', '{STRANGER}', '{STRANGER}', '{TEST_ETH}', 'test.eth');
                "#
            )
            .as_str(),
        )
        .await
        .expect("failed to add primary name records");
        let expected = vec![(VITALIK.to_string(), "vitalik.eth".to_string())];
        assert_eq!(primary_names(&pool).await, expected);

        // names that never expire carry type(uint64).max, which `to_timestamp` rejects
        pool.execute(
            format!(
                "UPDATE sgd1.domain SET expiry_date = 18446744073709551615 WHERE id = '{VITALIK_ETH}'"
            )
            .as_str(),
        )
        .await
        .expect("failed to update vitalik domain");
        assert_eq!(primary_names(&pool).await, expected);
    }
}
