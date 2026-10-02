import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const steps = ["typecheck", "test", "lint", "format:check", "build"];

function executeStep(step) {
  const windows = process.platform === "win32";
  return spawnSync(windows ? "npm.cmd" : "npm", ["run", step], {
    cwd: projectRoot,
    stdio: "inherit",
    // Windows 批处理需要 shell；命令及参数仅来自固定内部列表。
    shell: windows,
  });
}

export function verifyBlock(execute = executeStep) {
  for (const step of steps) {
    console.log(`[verify:block] 开始 npm run ${step}`);
    let result;
    try {
      result = execute(step);
    } catch (error) {
      console.error(`[verify:block] ${step} 启动失败`, error);
      return 1;
    }
    if (result.error) {
      console.error(`[verify:block] ${step} 启动失败`, result.error);
      return 1;
    }
    const code = result.status ?? 1;
    console.log(`[verify:block] ${step} 退出码 ${code}`);
    if (code !== 0) return code;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = verifyBlock();
}
