import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const steps = ["typecheck", "test", "lint", "format:check", "build"];

// 导出仅供平台回归测试使用；固定步骤列表与 CLI 编排保持私有。
// options 允许测试覆盖 env/stdio；默认行为与 CLI、hook 一致（继承当前环境与 stdio）。
export function executeStep(step, { env = process.env, stdio = "inherit" } = {}) {
  const windows = process.platform === "win32";
  if (windows) {
    // cmd.exe 直启替代 shell:true，消除 Node 的 DEP0190；参数仅来自固定内部列表。
    return spawnSync("cmd.exe", ["/d", "/s", "/c", "npm", "run", step], {
      cwd: projectRoot,
      stdio,
      env,
    });
  }
  return spawnSync("npm", ["run", step], {
    cwd: projectRoot,
    stdio,
    env,
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
