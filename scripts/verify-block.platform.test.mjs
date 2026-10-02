import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { URL } from "node:url";
import { executeStep } from "./verify-block.mjs";

// 平台回归：真实默认启动器（Windows cmd.exe+npm 路径，其余平台 npm 直启）。
// 目标脚本选 format:check：真实门禁步骤、秒级完成、成功输出可断言；
// 不选 test:governance，因其自身包含本文件会造成递归调用。
function sanitizedEnv() {
  const env = { ...process.env };
  // node:test 运行器上下文不得传入被启动的门禁进程，避免干扰其子进程行为。
  delete env.NODE_TEST_CONTEXT;
  return env;
}

async function collectDep0190(run) {
  const warnings = [];
  const onWarning = (warning) => {
    if (warning.code === "DEP0190") warnings.push(warning);
  };
  process.on("warning", onWarning);
  try {
    await run();
  } finally {
    await setImmediate();
    process.off("warning", onWarning);
  }
  return warnings;
}

test("DEP0190 检测器能捕获异步派发的受控警告", async () => {
  const warnings = await collectDep0190(() => {
    process.emitWarning("检测器探针", { code: "DEP0190", type: "DeprecationWarning" });
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, "检测器探针");
});

test("真实启动器可运行 npm 脚本且不触发 DEP0190 弃用警告", async () => {
  const warnings = await collectDep0190(() => {
    const result = executeStep("format:check", { env: sanitizedEnv(), stdio: "pipe" });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    const output = `${result.stdout ?? ""}`;
    assert.match(output, /All matched files use Prettier code style!/, "子进程应真实完成格式检查");
  });
  assert.deepEqual(warnings, []);
});

test("真实 CLI 保留首项退出码 7 并停止后续步骤，拒绝零退出码假绿灯", () => {
  const root = mkdtempSync(join(tmpdir(), "verify-block-cli-"));
  try {
    mkdirSync(join(root, "scripts"));
    const cli = join(root, "scripts", "verify-block.mjs");
    copyFileSync(new URL("./verify-block.mjs", import.meta.url), cli);
    const laterSteps = ["test", "lint", "format:check", "build"];
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: 'node -e "process.exit(7)"',
          ...Object.fromEntries(
            laterSteps.map((step) => [step, "node -e \"console.log('UNEXPECTED_LATER_STEP')\""]),
          ),
        },
      }),
    );
    const env = { ...sanitizedEnv(), npm_config_logs_max: "0" };
    const run = () => spawnSync(process.execPath, [cli], { env, encoding: "utf8" });
    const result = run();
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.equal(result.error, undefined);
    assert.equal(result.status, 7, output);
    assert.match(output, /\[verify:block\] 开始 npm run typecheck/);
    assert.match(output, /\[verify:block\] typecheck 退出码 7/);
    for (const step of laterSteps) {
      assert.ok(!output.includes(`[verify:block] 开始 npm run ${step}`), output);
    }
    assert.doesNotMatch(output, /UNEXPECTED_LATER_STEP/);

    // 仅篡改临时复制件，保留真实失败日志但把 CLI 退出码伪装为零。
    writeFileSync(
      cli,
      readFileSync(cli, "utf8").replace(
        "process.exitCode = verifyBlock();",
        "process.exitCode = (verifyBlock(), 0);",
      ),
    );
    const probe = run();
    assert.equal(probe.error, undefined);
    assert.equal(probe.status, 0);
    assert.match(`${probe.stdout}${probe.stderr}`, /\[verify:block\] typecheck 退出码 7/);
    assert.throws(() => assert.equal(probe.status, 7), {
      code: "ERR_ASSERTION",
      actual: 0,
      expected: 7,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
