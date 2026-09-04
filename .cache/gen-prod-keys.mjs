// 一次性生产密钥生成（输出到 contracts/keys/，该目录已被 .gitignore 忽略）
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "contracts", "keys");
mkdirSync(outDir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(join(outDir, "prod-ed25519-private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(join(outDir, "prod-ed25519-public.pem"), publicKey.export({ type: "spki", format: "pem" }));
console.log("OK: prod keypair written to contracts/keys/");
