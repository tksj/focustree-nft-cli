This is a tool for transferring FocusTree NFTs.
By creating a .env file, entering the following information, and running the script, you can transfer any NFT.
Note: Token transfers are not supported.

# .env file

```
PRIVATE_KEY=Private key of the sender  
SENDER_ADDRESS=Sender’s address  
RECEIVER_ADDRESS=Recipient’s address  
NFT_CONTRACT_ADDRESS=NFT contract address  
TOKEN_ID=Token ID  
RPC_URL=RPC endpoint URL  
```
# Supported RPC Version
Confirmed working with RPC spec version 0.8.1.

# NFT Contract Address
The FocusTree NFT contract address is:

```
0x0377c2d65debb3978ea81904e7d59740da1f07412e30d01c5ded1c5d6f1ddc43
```

# Run the transfer script
pnpm ts-node transfer-ft.ts
