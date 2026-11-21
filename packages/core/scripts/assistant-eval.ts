import { runAssistantEval } from "../src/assistant/eval/runner";

const report = runAssistantEval();

console.log(
  JSON.stringify(
    {
      version: report.version,
      totalCases: report.totalCases,
      intentAccuracyPct: `${(report.intentAccuracy * 100).toFixed(1)}%`,
      requiredInfoRatePct: `${(report.requiredInfoRate * 100).toFixed(1)}%`,
      handoffAccuracyPct: `${(report.handoffAccuracy * 100).toFixed(1)}%`,
      fabricatedNumberCount: report.fabricatedNumberCount,
      internalLeakCount: report.internalLeakCount,
      passed: report.passed,
      failures: report.failures,
    },
    null,
    2,
  ),
);

if (!report.passed) {
  process.exit(1);
}

