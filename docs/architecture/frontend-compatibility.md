# Frontend compatibility set

Status: Active scaffold baseline

Recorded: 2026-08-13

Wanaflow pins a tested compatibility set rather than using floating `latest`
ranges. The first frontend scaffold uses:

| Layer | Package | Version |
| --- | --- | --- |
| Runtime | Node.js | 22 or newer |
| Package manager | pnpm | 11.20.0 |
| Monorepo tasks | Turborepo | 2.10.9 |
| Web framework | Next.js | 16.3.0 |
| UI runtime | React / React DOM | 19.2.8 |
| Styling | Tailwind CSS | 4.3.3 |
| Component source CLI | shadcn | 4.17.0 |
| Icons | Lucide React | 1.31.0 |
| Authentication | Better Auth | 1.6.27 |
| BPMN modeler | bpmn-js | 18.24.0 |
| BPMN import layout | bpmn-auto-layout | 1.3.0 |
| BPMN properties | bpmn-js-properties-panel | 5.63.0 |
| DMN modeler | dmn-js | 17.10.1 |
| DMN parser | dmn-moddle | 12.0.1 |
| FEEL evaluator | @bpmn-io/feelin | 6.1.0 |
| Form builder | @bpmn-io/form-js | 1.24.1 |
| Type checking | TypeScript | 6.0.3 |
| Linting | ESLint / eslint-config-next | 9.39.5 / 16.3.0 |
| Browser testing | Playwright | 1.62.1 |

TypeScript 7 and ESLint 10 were current at scaffold time but exceeded the peer
ranges of the current Next.js lint stack. Wanaflow therefore uses the newest
compatible major versions and keeps peer checks clean.

The BPMN, DMN decision-table, and form-js editor routes use this tested set.
bpmn.io upgrades remain grouped and must pass import,
rendering, interaction, and round-trip fixtures before this table changes.
