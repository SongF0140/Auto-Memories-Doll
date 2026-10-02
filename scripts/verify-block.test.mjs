import assert from "node:assert/strict";
import test from "node:test";

const steps = ["typecheck", "test", "lint", "format:check", "build"];

async function verify(execute) {
  const { verifyBlock } = await import("./verify-block.mjs");
  return verifyBlock(execute);
}

test("五项成功时按固定顺序执行并返回零", async () => {
  const calls = [];
  const code = await verify((step) => {
    calls.push(step);
    return { status: 0 };
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, steps);
});

test("第三项失败时保留退出码且不执行后续步骤", async () => {
  const calls = [];
  const code = await verify((step) => {
    calls.push(step);
    return { status: step === "lint" ? 7 : 0 };
  });
  assert.equal(code, 7);
  assert.deepEqual(calls, steps.slice(0, 3));
});

test("第一项失败后立即停止", async () => {
  const calls = [];
  const code = await verify((step) => {
    calls.push(step);
    return { status: 2 };
  });
  assert.equal(code, 2);
  assert.deepEqual(calls, ["typecheck"]);
});

test("启动返回 error 时失败停止，即使 status 为零", async () => {
  const calls = [];
  const code = await verify((step) => {
    calls.push(step);
    return { status: 0, error: new Error("spawn ENOENT") };
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, ["typecheck"]);
});

test("执行器抛出启动异常时失败停止", async () => {
  const calls = [];
  const code = await verify((step) => {
    calls.push(step);
    throw new Error("启动异常");
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, ["typecheck"]);
});

test("进程被信号终止时不能视为成功", async () => {
  const calls = [];
  const code = await verify((step) => {
    calls.push(step);
    return { status: null, signal: "SIGTERM" };
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, ["typecheck"]);
});
