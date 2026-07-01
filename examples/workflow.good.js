// Example dynamic-workflow script with correct per-stage model pinning.
// `ultracost check examples/workflow.good.js` reports zero findings.
//
// Pattern: orchestrator/planning + synthesis on opus; mechanical fan-out on sonnet.

export default async function ({ agent, parallel, phase, args }) {
  // Planning is a decision → opus @ xhigh.
  const plan = await agent('Design the migration plan for ' + args.target, {
    model: 'opus',
    effort: 'xhigh'
  });

  // Mechanical, pre-planned fan-out → sonnet.
  const files = await agent('List every file matching the plan glob', {
    model: 'sonnet'
  });

  await phase('apply', async () => {
    await parallel(
      files.map((file) =>
        agent('Apply the planned edit to ' + file, { model: 'sonnet' })
      )
    );
  });

  // Cross-file review is reasoning → opus.
  const review = await agent('Adversarially review the applied changes', {
    model: 'opus',
    effort: 'xhigh'
  });

  // Final consolidation → opus.
  return agent('Consolidate the review into a report', {
    model: 'opus',
    effort: 'xhigh'
  });
}
