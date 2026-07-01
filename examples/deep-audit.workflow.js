// A real-shape ultracode dynamic-workflow: a parallel codebase audit that fans out one
// reviewer per source file, runs cross-cutting specialist passes, adversarially verifies
// each finding, then synthesizes a prioritized report. It is the kind of workflow Claude
// Code authors on its own from a prompt like "do a thorough audit of this repo" — see
// docs/SHOWCASE.md for the live run that produced it.
//
// Every agent() stage pins a model + effort per the ultracost policy, so it is
// guard-clean: `ultracost check examples/deep-audit.workflow.js` reports zero findings,
// and `ultracost estimate examples/deep-audit.workflow.js` shows the tiered cost.
//
// Routing: discovery + per-file scans + finding verification are pre-planned mechanical
// work -> sonnet (low effort). Security/performance/coverage/completeness analysis is
// reasoning -> opus. Planning and the final consolidation are alwaysOpus roles -> opus.

export default async function ({ agent, parallel, phase, args }) {
  // Planning is a decision, and "planner" is an alwaysOpus role -> opus @ xhigh.
  const plan = await agent('Plan the audit: list the dimensions to check across ' + args.repo, {
    model: 'opus',
    effort: 'high'
  });

  // Mechanical discovery -> sonnet @ low.
  const files = await agent('List every source file under ' + args.repo + '/src', {
    model: 'sonnet',
    effort: 'low'
  });

  // Fan-out: one reviewer per file. A pre-planned single-pass scan -> sonnet @ low.
  const findings = await phase('review', async () =>
    parallel(
      files.map((file) =>
        agent('Scan ' + file + ' for missing error handling and collect each gap with a line number', {
          model: 'sonnet',
          effort: 'low'
        })
      )
    )
  );

  // Cross-cutting specialist passes: each is genuine analysis/reasoning -> opus.
  const crossCut = await phase('cross-cut', async () =>
    parallel([
      agent('Analyze the collected gaps for security risk and rank them', { model: 'opus', effort: 'high' }),
      agent('Analyze performance hotspots implied by the gaps', { model: 'opus', effort: 'high' }),
      agent('Evaluate the test-coverage gaps the audit exposes', { model: 'opus', effort: 'high' }),
      agent('Assess overall completeness of the audit against the plan', { model: 'opus', effort: 'high' })
    ])
  );

  // Adversarial verification: re-run each finding against the source to confirm or
  // refute. Pre-planned, evidence-checking work -> sonnet.
  const verified = await phase('verify', async () =>
    parallel(
      findings.map((finding) =>
        agent('Run the reported gap against the real source and report confirm or refute: ' + finding, {
          model: 'sonnet',
          effort: 'low'
        })
      )
    )
  );

  // Final consolidation is an alwaysOpus role and hard synthesis -> opus @ xhigh.
  return agent('Consolidate and prioritize the verified findings into one P0-P3 report', {
    model: 'opus',
    effort: 'xhigh',
    context: { plan, crossCut, verified }
  });
}
