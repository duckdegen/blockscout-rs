import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  clearStore,
  describe,
  test,
} from "matchstick-as/assembly/index";

import { Domain, PrimaryNameRecord } from "../generated/schema";
import {
  handleAddrChanged,
  handleNameRegistered,
  handleNameRenewed,
  handlePrimaryNameSet,
  handleSubdomainRegistered,
  handleTransfer,
} from "../src/gwei-name-service";
import { GWEI_NODE, tokenIdToDomainID } from "../src/utils";
import {
  addrChangedEvent,
  nameRegisteredEvent,
  nameRenewedEvent,
  primaryNameSetEvent,
  subdomainRegisteredEvent,
  transferEvent,
} from "./gwei-name-service-utils";

const OWNER = "0x0000000000000000000000000000000000000001";
const RECIPIENT = "0x0000000000000000000000000000000000000002";
const EXPLICIT = "0x0000000000000000000000000000000000000003";

function registerName(
  tokenId: BigInt,
  label: string,
  expiresAt: i32,
  timestamp: i32 = 1
): void {
  handleNameRegistered(
    nameRegisteredEvent(
      tokenId,
      label,
      Address.fromString(OWNER),
      BigInt.fromI32(expiresAt),
      timestamp
    )
  );
}

function registerSubdomain(
  tokenId: BigInt,
  parentId: BigInt,
  label: string,
  timestamp: i32 = 1
): void {
  registerName(tokenId, label, 0, timestamp);
  handleSubdomainRegistered(
    subdomainRegisteredEvent(tokenId, parentId, label)
  );
}

describe("Gwei Name Service mapping", () => {
  afterEach(() => {
    clearStore();
  });

  test("indexes a registration and invalidates an owner-fallback primary name after transfer", () => {
    let tokenId = BigInt.fromI32(1);
    let domainID = tokenIdToDomainID(tokenId);
    handleNameRegistered(
      nameRegisteredEvent(
        tokenId,
        "alice",
        Address.fromString(OWNER),
        BigInt.fromI32(1000)
      )
    );

    assert.fieldEquals("Domain", domainID, "name", "alice.gwei");
    assert.fieldEquals("Domain", domainID, "parent", GWEI_NODE);
    assert.fieldEquals("Domain", domainID, "owner", OWNER);
    assert.fieldEquals("Domain", domainID, "resolvedAddress", OWNER);
    assert.fieldEquals("Domain", domainID, "expiryDate", "1000");

    handlePrimaryNameSet(
      primaryNameSetEvent(Address.fromString(OWNER), tokenId)
    );
    assert.fieldEquals(
      "PrimaryNameRecord",
      OWNER,
      "domain_name",
      "alice.gwei"
    );

    handleTransfer(
      transferEvent(
        Address.fromString(OWNER),
        Address.fromString(RECIPIENT),
        tokenId
      )
    );
    assert.fieldEquals("Domain", domainID, "owner", RECIPIENT);
    assert.fieldEquals("Domain", domainID, "resolvedAddress", RECIPIENT);
    let oldPrimary = PrimaryNameRecord.load(OWNER)!;
    assert.assertNull(oldPrimary.domain_name);
  });

  test("keeps an explicit resolved address across ERC-721 transfers", () => {
    let tokenId = BigInt.fromI32(2);
    let domainID = tokenIdToDomainID(tokenId);
    handleNameRegistered(
      nameRegisteredEvent(
        tokenId,
        "explicit",
        Address.fromString(OWNER),
        BigInt.fromI32(1000)
      )
    );
    handleAddrChanged(
      addrChangedEvent(tokenId, Address.fromString(EXPLICIT))
    );
    handlePrimaryNameSet(
      primaryNameSetEvent(Address.fromString(EXPLICIT), tokenId)
    );
    handleTransfer(
      transferEvent(
        Address.fromString(OWNER),
        Address.fromString(RECIPIENT),
        tokenId
      )
    );

    assert.fieldEquals("Domain", domainID, "owner", RECIPIENT);
    assert.fieldEquals("Domain", domainID, "resolvedAddress", EXPLICIT);
    assert.fieldEquals(
      "PrimaryNameRecord",
      EXPLICIT,
      "domain_name",
      "explicit.gwei"
    );
  });

  test("constructs subdomain names and snapshots inherited expiry", () => {
    let parentId = BigInt.fromI32(3);
    let childId = BigInt.fromI32(4);
    let parentDomainID = tokenIdToDomainID(parentId);
    let childDomainID = tokenIdToDomainID(childId);
    handleNameRegistered(
      nameRegisteredEvent(
        parentId,
        "alice",
        Address.fromString(OWNER),
        BigInt.fromI32(1000)
      )
    );
    handleNameRegistered(
      nameRegisteredEvent(
        childId,
        "pay",
        Address.fromString(OWNER),
        BigInt.fromI32(0)
      )
    );
    handleSubdomainRegistered(
      subdomainRegisteredEvent(childId, parentId, "pay")
    );

    assert.fieldEquals("Domain", childDomainID, "name", "pay.alice.gwei");
    assert.fieldEquals("Domain", childDomainID, "parent", parentDomainID);
    assert.fieldEquals("Domain", childDomainID, "expiryDate", "1000");
    assert.fieldEquals("Domain", parentDomainID, "subdomainCount", "1");
    let child = Domain.load(childDomainID)!;
    assert.assertNotNull(child.resolver);
  });

  test("extends subdomains at every level when the top-level name is renewed", () => {
    let parentId = BigInt.fromI32(10);
    let childId = BigInt.fromI32(11);
    let grandchildId = BigInt.fromI32(12);
    let siblingId = BigInt.fromI32(13);
    registerName(parentId, "alice", 1000);
    registerSubdomain(childId, parentId, "pay");
    registerSubdomain(grandchildId, childId, "x");
    registerSubdomain(siblingId, parentId, "shop");

    handleNameRenewed(nameRenewedEvent(parentId, BigInt.fromI32(2000)));

    assert.fieldEquals(
      "Domain",
      tokenIdToDomainID(parentId),
      "expiryDate",
      "2000"
    );
    assert.fieldEquals(
      "Domain",
      tokenIdToDomainID(childId),
      "expiryDate",
      "2000"
    );
    assert.fieldEquals(
      "Domain",
      tokenIdToDomainID(grandchildId),
      "expiryDate",
      "2000"
    );
    assert.fieldEquals(
      "Domain",
      tokenIdToDomainID(siblingId),
      "expiryDate",
      "2000"
    );
    assert.fieldEquals(
      "Registration",
      tokenIdToDomainID(grandchildId),
      "expiryDate",
      "2000"
    );
  });

  test("leaves subdomains of an expired registration expired after the name is registered again", () => {
    let parentId = BigInt.fromI32(20);
    let staleId = BigInt.fromI32(21);
    let freshId = BigInt.fromI32(22);
    let parentDomainID = tokenIdToDomainID(parentId);
    registerName(parentId, "alice", 1000);
    registerSubdomain(staleId, parentId, "pay");

    registerName(parentId, "alice", 20000, 10000);
    assert.fieldEquals("Domain", parentDomainID, "subdomainCount", "0");
    registerSubdomain(freshId, parentId, "shop", 10000);
    handleNameRenewed(nameRenewedEvent(parentId, BigInt.fromI32(30000)));

    assert.fieldEquals(
      "Domain",
      tokenIdToDomainID(staleId),
      "expiryDate",
      "1000"
    );
    assert.fieldEquals(
      "Domain",
      tokenIdToDomainID(freshId),
      "expiryDate",
      "30000"
    );
    assert.fieldEquals("Domain", parentDomainID, "subdomainCount", "1");

    // registering the stale subdomain again makes it valid under the new parent
    registerSubdomain(staleId, parentId, "pay", 10000);
    assert.fieldEquals(
      "Domain",
      tokenIdToDomainID(staleId),
      "expiryDate",
      "30000"
    );
    assert.fieldEquals("Domain", parentDomainID, "subdomainCount", "2");
    handleNameRenewed(nameRenewedEvent(parentId, BigInt.fromI32(40000)));
    assert.fieldEquals(
      "Domain",
      tokenIdToDomainID(staleId),
      "expiryDate",
      "40000"
    );
  });

  test("expires the descendants of a subdomain reclaimed by the parent owner", () => {
    let parentId = BigInt.fromI32(30);
    let childId = BigInt.fromI32(31);
    let grandchildId = BigInt.fromI32(32);
    let parentDomainID = tokenIdToDomainID(parentId);
    let childDomainID = tokenIdToDomainID(childId);
    let grandchildDomainID = tokenIdToDomainID(grandchildId);
    registerName(parentId, "alice", 1000);
    registerSubdomain(childId, parentId, "pay");
    registerSubdomain(grandchildId, childId, "x");

    registerSubdomain(childId, parentId, "pay", 500);

    assert.fieldEquals("Domain", childDomainID, "expiryDate", "1000");
    assert.fieldEquals("Domain", childDomainID, "subdomainCount", "0");
    assert.fieldEquals("Domain", grandchildDomainID, "expiryDate", "500");
    assert.fieldEquals("Domain", parentDomainID, "subdomainCount", "1");

    // a later renewal must not revive the invalidated descendant
    handleNameRenewed(nameRenewedEvent(parentId, BigInt.fromI32(2000)));
    assert.fieldEquals("Domain", childDomainID, "expiryDate", "2000");
    assert.fieldEquals("Domain", grandchildDomainID, "expiryDate", "500");
  });
});
