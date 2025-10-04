import 'dotenv/config';
import fs from 'fs';
import { RpcProvider, Account, Contract, ec } from 'starknet';

const provider = new RpcProvider({
    nodeUrl: process.env.RPC_URL!,
    specVersion: '0.8.1',
});

const spec = await provider.getSpecVersion(); // ex: '0.7.1' / '0.8.1'
console.log('RPC spec =', spec);

const senderAddressRaw = process.env.SENDER_ADDRESS!;
console.log('SENDER raw =', JSON.stringify(senderAddressRaw), senderAddressRaw.length);
const senderAddress = senderAddressRaw.trim().toLowerCase();

const privateKey = process.env.PRIVATE_KEY?.trim()!;
const receiverAddress = process.env.RECEIVER_ADDRESS?.trim()!.toLowerCase();
const nftContractAddress = process.env.NFT_CONTRACT_ADDRESS?.trim()!.toLowerCase();
const tokenIdBigInt = BigInt(process.env.TOKEN_ID ?? '0');

function required(name: string, val?: string) {
    if (!val || !val.trim()) throw new Error(`Missing env: ${name}`);
}
required('SENDER_ADDRESS', senderAddress);
required('PRIVATE_KEY', privateKey);
required('RECEIVER_ADDRESS', receiverAddress);
required('NFT_CONTRACT_ADDRESS', nftContractAddress);
if (tokenIdBigInt <= 0n) throw new Error('invaild TOKEN_ID');

// loading ABI files
const ftAbi = JSON.parse(fs.readFileSync('./focustreeABI.json', 'utf-8'));          // FocusTree account ABI
const nftAbi = JSON.parse(fs.readFileSync('./focustreeNftAbI.json', 'utf-8'));      // ERC-721 ABI（Cairo）

// [1](https://github.com/OpenZeppelin/openzeppelin-contracts/issues/3362)
async function verifyFocusTreeKey() {
    const ftAccountContract = new Contract(ftAbi, senderAddress, provider);
    const onchainPkResp = await ftAccountContract.call('get_public_key', []);
    const onchainPkHex =
        typeof onchainPkResp === 'bigint'
            ? '0x' + onchainPkResp.toString(16)
            : String(onchainPkResp);

    const derivedPk = ec.starkCurve.getStarkKey(privateKey);
    if (onchainPkHex.toLowerCase() !== derivedPk.toLowerCase()) {
        throw new Error(
            `The public key and private key of FocusTree do not match. \n` +
            `onchain=${onchainPkHex}\nderived=${derivedPk}`
        );
    }
    console.log('🔑 FocusTree鍵 検証OK');
}

// ---- normalize（string/bigint/array/object → 0x.. ） ----
const normalizeAddr = (v: any): string => {
    const inner = (x: any): string => {
        if (typeof x === 'string') return x.toLowerCase();
        if (typeof x === 'bigint') return ('0x' + x.toString(16)).toLowerCase();
        if (Array.isArray(x)) return inner(x[0]);
        if (x && typeof x === 'object') {
            return inner(x.owner ?? x.owner_of ?? x.address ?? x.contract_address ?? Object.values(x)[0]);
        }
        throw new Error('Unexpected address-like shape');
    };
    return inner(v);
};

async function main() {
    await verifyFocusTreeKey();

    const account = new Account(provider, senderAddress, privateKey);

    const nft = new Contract(nftAbi, nftContractAddress, provider);
    nft.connect(account);

    const ownerResp = await nft.call('owner_of', [tokenIdBigInt]); 
    debugAddrDiff(ownerResp, senderAddress); 

    if (!eqAddress(ownerResp, senderAddress)) {
        throw new Error(`The current owner is not the sender.: ${toCanonicalHexAddr(ownerResp)}`);
    }

    const populated = nft.populate('transfer_from', [
        senderAddress, 
        receiverAddress, 
        tokenIdBigInt, 
    ]);

    const fee = await account.estimateInvokeFee([populated]);

    const toHex = (x: bigint) => '0x' + x.toString(16);
    const mul = (x: bigint, num: bigint, den: bigint = 1n) => (x * num) / den;
    const withBuf = (x: bigint) => mul(x, 3n, 2n); // 1.5x バッファ

    const l1GasConsumed = BigInt(fee.l1_gas_consumed ?? 0n);
    const l1GasPrice = BigInt(fee.l1_gas_price ?? 0n);
    const l1DataConsumed = BigInt(fee.l1_data_gas_consumed ?? 0n);
    const l1DataPrice = BigInt(fee.l1_data_gas_price ?? 0n);

    let resourceBounds: any;

    if (spec.startsWith('0.7')) {
        resourceBounds = {
            l2_gas: { max_amount: '0x0', max_price_per_unit: '0x0' },
            l1_gas: {
                max_amount: toHex(fee.resourceBounds?.l1_gas?.max_amount
                    ? BigInt(fee.resourceBounds.l1_gas.max_amount)
                    : withBuf(l1GasConsumed)),
                max_price_per_unit: toHex(fee.resourceBounds?.l1_gas?.max_price_per_unit
                    ? BigInt(fee.resourceBounds.l1_gas.max_price_per_unit)
                    : (l1GasPrice || 1n)),
            },
        };
    } else {
        resourceBounds = {
            l2_gas: {
                max_amount: toHex(BigInt(fee.resourceBounds?.l2_gas?.max_amount ?? 0n)),
                max_price_per_unit: toHex(BigInt(fee.resourceBounds?.l2_gas?.max_price_per_unit ?? 0n)),
            },
            l1_gas: {
                max_amount: toHex(fee.resourceBounds?.l1_gas?.max_amount
                    ? BigInt(fee.resourceBounds.l1_gas.max_amount)
                    : withBuf(l1GasConsumed)),
                max_price_per_unit: toHex(fee.resourceBounds?.l1_gas?.max_price_per_unit
                    ? BigInt(fee.resourceBounds.l1_gas.max_price_per_unit)
                    : (l1GasPrice || 1n)),
            },
            l1_data_gas: {
                max_amount: toHex(withBuf(l1DataConsumed)),
                max_price_per_unit: toHex(l1DataPrice || l1GasPrice || 1n),
            },
        };
    }

    console.log('resourceBounds=', resourceBounds);

    const tx = await account.execute([populated], { resourceBounds });
    console.log('✅ success:', tx.transaction_hash);
    await provider.waitForTransaction(tx.transaction_hash);
    console.log(`🔗 Voyager: https://voyager.online/tx/${tx.transaction_hash}`);

}

main().catch((e) => {
    console.error('❌ failed:', e);
    process.exit(1);
})

function toAddrBigInt(v: unknown): bigint {
    const inner = (x: any): bigint => {
        if (typeof x === 'bigint') return x;
        if (typeof x === 'string') {
            const s = x.trim();

            if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
            return BigInt(s); 
        }
        if (Array.isArray(x)) return inner(x[0]);
        if (x && typeof x === 'object') {
            return inner(x.owner ?? x.owner_of ?? x.address ?? x.contract_address ?? Object.values(x)[0]);
        }
        throw new Error('Unexpected address-like value: ' + String(x));
    };
    return inner(v);
}

function toCanonicalHexAddr(v: unknown): string {
    const bi = toAddrBigInt(v);
    const hex = bi.toString(16); 
    return '0x' + hex.padStart(64, '0'); 
}

function eqAddress(a: unknown, b: unknown): boolean {
    return toCanonicalHexAddr(a) === toCanonicalHexAddr(b);
}

function debugAddrDiff(a: unknown, b: unknown) {
    console.log('🧪 string equality:', String(a).toLowerCase() === String(b).toLowerCase());
    console.log('🧪 bigint equality:', toAddrBigInt(a) === toAddrBigInt(b));
    console.log('🧪 canonical a:', toCanonicalHexAddr(a));
    console.log('🧪 canonical b:', toCanonicalHexAddr(b));
}