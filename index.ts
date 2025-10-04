import dotenv from 'dotenv';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { getStarkKey, utils as starkUtils } from '@scure/starknet';
import { hash } from 'starknet';


dotenv.config();

const MNEMONIC = process.env.MNEMONIC as string;
const TARGET_ADDRESS = process.env.TARGET_ADDRESS as string;
const CLASS_HASH = process.env.CLASS_HASH as string;
const SALT = BigInt("0x0000000000000000000000000000000000000000000000000000000000000002");
const CONSTRUCTOR_CALLDATA = [
  "0x04f6f1b6f7b0e0c5e0b5f1a6e3a6c1d2f3e4a5b6c7d8e9f0a1b2c3d4e5f60718"
];


if (!MNEMONIC) throw new Error('MNEMONIC が .env に設定されていません');
if (!TARGET_ADDRESS) throw new Error('TARGET_ADDRESS が .env に設定されていません');
if (!CLASS_HASH) throw new Error('CLASS_HASH が .env に設定されていません');

const MAX_ATTEMPTS = 1000;
const seed = mnemonicToSeedSync(MNEMONIC);
const root = HDKey.fromMasterSeed(seed);



function mod(a: bigint, b: bigint): bigint {
    const result = a % b;
    return result >= 0n ? result : result + b;
}

// ORDERを定数として定義
const STARK_ORDER = BigInt('3618502788666131106986593281521497120414687020801267626233049502753703925761');


let found = false;

for (let index = 0; index < MAX_ATTEMPTS; index++) {
    const derivationPath = `m/44'/9004'/0'/0/${index}`;
    const child = root.derive(derivationPath);

    if (!child.privateKey) {
        console.warn(`Index ${index}: 秘密鍵が取得できませんでした`);
        continue;
    }

    // 秘密鍵をStarkNetのORDERで正規化
    const privateKeyBigInt = BigInt('0x' + Buffer.from(child.privateKey).toString('hex'));
    const normalizedPrivateKey = mod(privateKeyBigInt, STARK_ORDER);
    const starkPrivateKeyHex = '0x' + normalizedPrivateKey.toString(16).padStart(64, '0');
    const starkPublicKey = getStarkKey(starkPrivateKeyHex);

    const accountAddress = hash.calculateContractAddressFromHash(
        starkPublicKey,
        CLASS_HASH,
        CONSTRUCTOR_CALLDATA,
        SALT
    );

    console.log(`Index ${index}: ${accountAddress}`);

    if (accountAddress.toLowerCase() === TARGET_ADDRESS.toLowerCase()) {
        console.log(`✅ 一致しました！インデックス: ${index}`);
        found = true;
        break;
    }
}

if (!found) {
    console.log(`❌ 最大 ${MAX_ATTEMPTS} 件試しましたが一致するアドレスは見つかりませんでした`);
}