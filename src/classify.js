import { tierModel } from './policy.js';

// Deterministic, offline classifier that maps a stage's prompt to the tier the work *reads
// like*, so the guard can flag a pin that disagrees with the task (UC006) and `explain` can
// justify a tier — all without an LLM (zero-dep, pure). It is more than a keyword bag:
//
//   1. Leading imperative verb — the strongest signal ("List …", "Design …", "Apply …") —
//      is weighted heavily and classified precisely (not just "first matched keyword").
//   2. Multiword PHRASE signals catch context a bag-of-words misses ("edge cases",
//      "tests pass", "type-check", "root cause", "is correct").
//   3. AMBIGUOUS verbs whose tier depends on WHAT they act on — verify / validate / check /
//      ensure / confirm / test — are disambiguated by the mechanical-vs-reasoning balance of
//      the surrounding words: "verify the tests pass / typecheck" → sonnet (mechanical),
//      "verify the logic is correct / handles edge cases" → opus (reasoning). A context-free
//      ambiguous verb stays low-confidence so the guard never warns on a coin-flip.
//
// Keyword lists are reused from the public model-router rubrics (smart-router /
// model-matchmaker / model-changer) and can be extended per policy via policy.classify.keywords.

const DEFAULT_KEYWORDS = {
  opus: [
    'design', 'architect', 'architecture', 'refactor', 'rewrite', 'debug', 'review',
    'audit', 'analyze', 'analyse', 'plan', 'planning', 'synthesize', 'synthesise',
    'synthesis', 'consolidate', 'evaluate', 'assess', 'optimize', 'optimise',
    'investigate', 'diagnose', 'reason', 'implement', 'security', 'vulnerability'
  ],
  sonnet: [
    'list', 'find', 'search', 'grep', 'glob', 'collect', 'gather', 'extract', 'fetch',
    'read', 'scan', 'enumerate', 'count', 'format', 'rename', 'apply', 'run', 'execute',
    'summarize', 'summarise', 'copy', 'move', 'retrieve', 'lookup', 'locate', 'file',
    'files', 'tests'
  ]
};

// alwaysOpus role names matched only as specific words — deliberately NOT 'plan'
// (too ambiguous, e.g. "the plan glob"). Custom roles fall back to their own long words.
const ROLE_SYNONYMS = {
  orchestrator: ['orchestrator', 'orchestrate'],
  planner: ['planner'],
  'final-synthesis': ['synthesis', 'synthesize', 'synthesise'],
  consolidation: ['consolidation', 'consolidate']
};

const words = (s) => String(s || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);

function keywordSet(tier, policy) {
  const extra = policy?.classify?.keywords?.[tier] || [];
  return new Set([...DEFAULT_KEYWORDS[tier], ...extra.map((w) => String(w).toLowerCase())]);
}

// Map a model alias/id to its tier name for comparison ('opus' | 'sonnet' | 'haiku').
export function tierOfModel(model) {
  const v = String(model).toLowerCase();
  if (v.includes('sonnet')) return 'sonnet';
  if (v.includes('haiku')) return 'haiku';
  return 'opus';
}

// Verbs whose tier depends on their object: "verify the tests pass" (mechanical → sonnet)
// vs "verify the logic is correct" (reasoning → opus). Resolved by surrounding context, not
// a flat keyword, so they are deliberately kept OUT of DEFAULT_KEYWORDS.
const AMBIGUOUS_VERBS = new Set(['verify', 'validate', 'check', 'ensure', 'confirm', 'test', 'recheck']);

// Single-word context that tips an ambiguous verb toward the mechanical (sonnet) reading…
const MECH_CONTEXT = new Set([
  'test', 'tests', 'typecheck', 'lint', 'linter', 'compile', 'compiles', 'build', 'builds',
  'pass', 'passes', 'passing', 'run', 'runs', 'running', 'snapshot', 'snapshots', 'ci',
  'coverage', 'command', 'output', 'exit', 'status', 'green', 'format', 'formatting', 'install', 'script'
]);
// …or the reasoning (opus) reading.
const REASON_CONTEXT = new Set([
  'correct', 'correctly', 'correctness', 'logic', 'behavior', 'behaviour', 'handles', 'handle',
  'handling', 'edge', 'security', 'secure', 'vulnerable', 'vulnerability', 'race', 'invariant',
  'invariants', 'semantics', 'sound', 'consistent', 'consistency', 'contract', 'reason',
  'reasoning', 'why', 'design', 'architecture', 'properly', 'assumption', 'assumptions',
  'regression', 'intended', 'spec', 'requirement', 'requirements'
]);

// Multiword signals a bag-of-words misses; each hit weighs like a strong keyword. Matched
// against the whole lowercased prompt, order-independent. [regex, human label].
const OPUS_PHRASES = [
  [/\bedge cases?\b/, 'edge cases'],
  [/\btrade[- ]?offs?\b/, 'trade-offs'],
  [/\broot cause\b/, 'root cause'],
  [/\bcross[- ]?file\b/, 'cross-file'],
  [/\bdata model\b/, 'data model'],
  [/\bthreat model\b/, 'threat model'],
  [/\brace conditions?\b/, 'race condition'],
  [/\b(?:is|are) correct\b/, 'is correct'],
  [/\bcorrectness\b/, 'correctness'],
  [/\bbreaking changes?\b/, 'breaking change'],
  [/\bbackwards?[- ]?compat/, 'backward-compat'],
  [/\bsecurity (?:review|issue|vuln|hole)/, 'security review']
];
const SONNET_PHRASES = [
  [/\btests? (?:pass|passes|passing)\b/, 'tests pass'],
  [/\btype[- ]?check/, 'typecheck'],
  [/\brun (?:the )?tests?\b/, 'run tests'],
  [/\breport (?:the )?(?:results?|findings?|output)\b/, 'report results'],
  [/\bexit code\b/, 'exit code'],
  [/\bfind all\b/, 'find all'],
  [/\blist all\b/, 'list all'],
  [/\bsearch for\b/, 'search for'],
  [/\bboilerplate\b/, 'boilerplate'],
  [/\b(?:copy|move) (?:the|all)\b/, 'copy/move']
];

// Filler that can precede the imperative verb ("Please verify …", "Now list …").
const LEADING_SKIP = new Set(['please', 'now', 'then', 'first', 'next', 'also', 'the', 'a', 'an', 'to']);

const leadingToken = (toks) => toks.find((w) => !LEADING_SKIP.has(w)) || null;

// Resolve an ambiguous verb by the mechanical-vs-reasoning balance of its prompt.
// Returns { tier|null, hits } — null means truly balanced (caller stays low-confidence).
function disambiguate(toks) {
  let mech = 0;
  let reason = 0;
  const hits = [];
  for (const w of toks) {
    if (MECH_CONTEXT.has(w)) { mech++; if (hits.length < 4) hits.push(w); }
    else if (REASON_CONTEXT.has(w)) { reason++; if (hits.length < 4) hits.push(w); }
  }
  const tier = mech > reason ? 'sonnet' : reason > mech ? 'opus' : null;
  return { tier, hits };
}

export function classifyPrompt(prompt, policy = {}) {
  const text = String(prompt || '').toLowerCase();
  const toks = words(text);
  const opus = keywordSet('opus', policy);
  const sonnet = keywordSet('sonnet', policy);
  const scores = { opus: 0, sonnet: 0 };
  const matched = [];
  const add = (tier, w, term) => { if (!tier) return; scores[tier] += w; if (term) matched.push(term); };

  // 1) Multiword phrase signals — context the bag-of-words misses.
  for (const [re, label] of OPUS_PHRASES) if (re.test(text)) add('opus', 3, label);
  for (const [re, label] of SONNET_PHRASES) if (re.test(text)) add('sonnet', 3, label);

  // 2) Leading imperative verb — the strongest single signal. Ambiguous verbs are resolved
  //    by surrounding mechanical-vs-reasoning context; a context-free one stays weak (low conf).
  const lead = leadingToken(toks);
  let hadLead = false;
  if (lead) {
    if (AMBIGUOUS_VERBS.has(lead)) {
      const d = disambiguate(toks);
      if (d.tier) add(d.tier, 4, `${lead} (${d.hits.slice(0, 2).join('/')})`);
      else add('opus', 2, `${lead} (ambiguous)`); // quality-first tie-break, deliberately weak
      hadLead = true;
    } else if (opus.has(lead)) { add('opus', 4, lead); hadLead = true; }
    else if (sonnet.has(lead)) { add('sonnet', 4, lead); hadLead = true; }
  }

  // 2b) An ambiguous verb elsewhere (when the lead wasn't one) still informs the tier, weaker.
  if (!hadLead) {
    const amb = toks.find((w) => AMBIGUOUS_VERBS.has(w));
    if (amb) {
      const d = disambiguate(toks);
      if (d.tier) add(d.tier, 3, `${amb} (${d.hits.slice(0, 2).join('/')})`);
    }
  }

  // 3) Keyword bag (built-in + policy.classify.keywords). Weak per word; the first match
  //    carries the imperative weight ONLY when no leading verb was classified above.
  let skipLead = hadLead && lead && (opus.has(lead) || sonnet.has(lead)); // ambiguous lead isn't in a set
  let firstBag = true;
  for (const w of toks) {
    if (skipLead && w === lead) { skipLead = false; continue; } // count the lead once, in step 2
    const tier = opus.has(w) ? 'opus' : sonnet.has(w) ? 'sonnet' : null;
    if (!tier) continue;
    add(tier, !hadLead && firstBag ? 3 : 1, w);
    firstBag = false;
  }

  const winner = scores.opus === scores.sonnet ? null : scores.opus > scores.sonnet ? 'opus' : 'sonnet';
  const top = Math.max(scores.opus, scores.sonnet);
  const margin = Math.abs(scores.opus - scores.sonnet);
  let confidence = 'none';
  if (winner) confidence = top >= 3 && margin >= 2 ? 'high' : 'low';
  return { tier: winner, confidence, scores, matched };
}

function matchedRole(prompt, roles = []) {
  const set = new Set(words(prompt));
  for (const role of roles) {
    const syns = ROLE_SYNONYMS[role] || words(role).filter((w) => w.length >= 5);
    if (syns.some((s) => set.has(s))) return role;
  }
  return null;
}

const effortRank = (effort, policy) => {
  const range = policy?.effort?.range || ['low', 'medium', 'high', 'xhigh'];
  return range.indexOf(effort);
};

// Advisory (warning-level) findings for a stage whose model is a valid literal pin:
//   UC006 the pinned model disagrees with the work the prompt describes,
//   UC007 the effort exceeds the model's cap,
//   UC008 an alwaysOpus role is pinned to a non-default tier.
// Returns partial finding objects ({ code, severity, message }); the caller adds
// file/line/column. Conservative by design — only fires on confident signals.
export function semanticFindings({ model, effort, prompt }, policy, CODES) {
  const out = [];
  const mtier = tierOfModel(model);
  const defaultTier = tierOfModel(tierModel(policy.default, policy));

  if (prompt) {
    const c = classifyPrompt(prompt, policy);
    if (c.tier && c.confidence === 'high' && c.tier !== mtier) {
      out.push({
        code: CODES.WRONGTIER,
        severity: 'warn',
        message: `stage reads like ${c.tier} work (${c.matched.slice(0, 3).join(', ')}) but pins "${model}" — consider model: '${c.tier}'`
      });
    }
    const role = matchedRole(prompt, policy.alwaysOpus);
    if (role && mtier !== defaultTier) {
      out.push({
        code: CODES.ALWAYSOPUS,
        severity: 'warn',
        message: `stage looks like the "${role}" role (policy.alwaysOpus) but pins "${model}" — these stay on ${tierModel(policy.default, policy)}`
      });
    }
  }

  if (effort) {
    const cap = policy?.effort?.maxByModel?.[mtier];
    if (cap && effortRank(effort, policy) > effortRank(cap, policy) && effortRank(effort, policy) !== -1) {
      out.push({
        code: CODES.OVEREFFORT,
        severity: 'warn',
        message: `effort '${effort}' exceeds the '${cap}' cap for ${mtier} (policy.effort.maxByModel)`
      });
    }
  }

  return out;
}
