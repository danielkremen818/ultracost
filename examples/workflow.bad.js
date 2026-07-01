// Example dynamic-workflow script with deliberate routing mistakes — the fixture the
// guard's negative tests run against. `ultracost check examples/workflow.bad.js`
// reports UC001 through UC008 (do NOT use this as a template).

export default async function ({ agent, parallel, pickModel }) {
  const a = await agent('do the thing');                                  // UC001 no options object
  const b = await agent('x', { effort: 'high' });                         // UC002 object without model
  const c = await agent('x', { model: 'haiku' });                         // UC003 banned model
  const d = await agent('x', { model: 'inherit' });                       // UC004 inherit
  const e = await agent('x', { model: pickModel() });                     // UC005 dynamic model
  const f = await agent('Refactor the auth module and fix the bug', { model: 'sonnet' }); // UC006 wrong-tier
  const g = await agent('List the files', { model: 'sonnet', effort: 'xhigh' });          // UC007 effort over cap
  const h = await agent('Act as the orchestrator and route subtasks', { model: 'sonnet' }); // UC008 alwaysOpus role

  return parallel([a, b, c, d, e, f, g, h]);
}
