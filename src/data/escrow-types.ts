/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/cosign_escrow.json`.
 */
export type CosignEscrow = {
  "address": "Fd9qA4pYkS43ordqGUVyYnaFZqAgRL1qZwa6nCBhC7Xq",
  "metadata": {
    "name": "cosignEscrow",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "initializeEscrow",
      "discriminator": [
        243,
        160,
        77,
        153,
        11,
        92,
        48,
        209
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "escrow",
          "writable": true
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": [
        {
          "name": "taskHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "sellers",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "amountPerSeller",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "refund",
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "caller",
          "signer": true
        },
        {
          "name": "escrow",
          "writable": true
        },
        {
          "name": "buyer",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "slot",
          "type": "u8"
        },
        {
          "name": "evidenceHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "release",
      "discriminator": [
        253,
        249,
        15,
        206,
        28,
        127,
        193,
        241
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "escrow",
          "writable": true
        },
        {
          "name": "seller",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "slot",
          "type": "u8"
        },
        {
          "name": "evidenceHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "escrow",
      "discriminator": [
        31,
        213,
        123,
        187,
        186,
        22,
        218,
        155
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidPool",
      "msg": "Seller pool must contain 1 to 4 distinct nonzero recipients"
    },
    {
      "code": 6001,
      "name": "invalidAmount",
      "msg": "Allocation must be positive and at most 0.1 SOL"
    },
    {
      "code": 6002,
      "name": "invalidExpiry",
      "msg": "Expiry must be in the next seven days"
    },
    {
      "code": 6003,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6004,
      "name": "invalidSlot",
      "msg": "Allocation index out of range"
    },
    {
      "code": 6005,
      "name": "alreadySettled",
      "msg": "Allocation already settled"
    },
    {
      "code": 6006,
      "name": "missingEvidence",
      "msg": "Settlement requires an evidence commitment"
    },
    {
      "code": 6007,
      "name": "expired",
      "msg": "Escrow has expired"
    },
    {
      "code": 6008,
      "name": "wrongRecipient",
      "msg": "Recipient differs from initialized seller"
    },
    {
      "code": 6009,
      "name": "unauthorized",
      "msg": "Only the verifier may settle; buyer may refund after expiry"
    }
  ],
  "types": [
    {
      "name": "escrow",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "taskHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sellers",
            "type": {
              "array": [
                "pubkey",
                4
              ]
            }
          },
          {
            "name": "amountPerSeller",
            "type": "u64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "states",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "evidenceHashes",
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                4
              ]
            }
          },
          {
            "name": "count",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
