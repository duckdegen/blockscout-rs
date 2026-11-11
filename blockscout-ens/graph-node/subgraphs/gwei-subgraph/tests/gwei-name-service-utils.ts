import {
  Address,
  BigInt,
  Bytes,
  crypto,
  ethereum,
} from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as/assembly/index";

import {
  AddrChanged,
  NameRegistered,
  NameRenewed,
  PrimaryNameSet,
  SubdomainRegistered,
  TextChanged,
  Transfer,
} from "../generated/NameNFT/NameNFT";
import { tokenIdToDomainID } from "../src/utils";

let nextLogIndex = 0;

// Mock events share one transaction, so give each its own log index the way
// real logs have: entity IDs derived from events must not collide.
function mockEvent(): ethereum.Event {
  let event = newMockEvent();
  event.logIndex = BigInt.fromI32(nextLogIndex);
  nextLogIndex = nextLogIndex + 1;
  return event;
}

export function nameRegisteredEvent(
  tokenId: BigInt,
  label: string,
  owner: Address,
  expiresAt: BigInt,
  timestamp: i32 = 1
): NameRegistered {
  let event = changetype<NameRegistered>(mockEvent());
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.parameters = [
    new ethereum.EventParam(
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    ),
    new ethereum.EventParam("label", ethereum.Value.fromString(label)),
    new ethereum.EventParam("owner", ethereum.Value.fromAddress(owner)),
    new ethereum.EventParam(
      "expiresAt",
      ethereum.Value.fromUnsignedBigInt(expiresAt)
    ),
  ];
  return event;
}

export function nameRenewedEvent(
  tokenId: BigInt,
  newExpiresAt: BigInt
): NameRenewed {
  let event = changetype<NameRenewed>(mockEvent());
  event.parameters = [
    new ethereum.EventParam(
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    ),
    new ethereum.EventParam(
      "newExpiresAt",
      ethereum.Value.fromUnsignedBigInt(newExpiresAt)
    ),
  ];
  return event;
}

export function subdomainRegisteredEvent(
  tokenId: BigInt,
  parentId: BigInt,
  label: string
): SubdomainRegistered {
  let event = changetype<SubdomainRegistered>(mockEvent());
  event.parameters = [
    new ethereum.EventParam(
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    ),
    new ethereum.EventParam(
      "parentId",
      ethereum.Value.fromUnsignedBigInt(parentId)
    ),
    new ethereum.EventParam("label", ethereum.Value.fromString(label)),
  ];
  return event;
}

export function transferEvent(
  from: Address,
  to: Address,
  tokenId: BigInt
): Transfer {
  let event = changetype<Transfer>(mockEvent());
  event.parameters = [
    new ethereum.EventParam("from", ethereum.Value.fromAddress(from)),
    new ethereum.EventParam("to", ethereum.Value.fromAddress(to)),
    new ethereum.EventParam(
      "id",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    ),
  ];
  return event;
}

export function addrChangedEvent(tokenId: BigInt, addr: Address): AddrChanged {
  let event = changetype<AddrChanged>(mockEvent());
  event.parameters = [
    new ethereum.EventParam(
      "node",
      ethereum.Value.fromFixedBytes(
        Bytes.fromHexString(tokenIdToDomainID(tokenId))
      )
    ),
    new ethereum.EventParam("addr", ethereum.Value.fromAddress(addr)),
  ];
  return event;
}

export function primaryNameSetEvent(
  addr: Address,
  tokenId: BigInt
): PrimaryNameSet {
  let event = changetype<PrimaryNameSet>(mockEvent());
  event.parameters = [
    new ethereum.EventParam("addr", ethereum.Value.fromAddress(addr)),
    new ethereum.EventParam(
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    ),
  ];
  return event;
}

export function textChangedEvent(
  tokenId: BigInt,
  key: string,
  value: string
): TextChanged {
  let event = changetype<TextChanged>(mockEvent());
  event.parameters = [
    new ethereum.EventParam(
      "node",
      ethereum.Value.fromFixedBytes(
        Bytes.fromHexString(tokenIdToDomainID(tokenId))
      )
    ),
    // an indexed string is logged as the keccak256 hash of its content
    new ethereum.EventParam(
      "key",
      ethereum.Value.fromFixedBytes(
        Bytes.fromByteArray(crypto.keccak256(Bytes.fromUTF8(key)))
      )
    ),
    new ethereum.EventParam("value", ethereum.Value.fromString(value)),
  ];
  return event;
}
