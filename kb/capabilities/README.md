# Standard capabilities and processes

Owner: Engineering standards · used by the Discovery agent (Fit-gap sub-agent) and by reviewers at the Discover gate.

The reference the fit-gap compares an org against: for each business area, the standard capabilities, their process
steps in business order, and the standard Salesforce objects and features of each step. Every step links the
official Salesforce sources behind it.

| Page | Covers |
|---|---|
| [consumer-goods-processes.md](consumer-goods-processes.md) | Retail Execution and Trade Promotion Management (Consumer Goods Cloud) |
| [core-processes.md](core-processes.md) | Customer master, product master, order to cash, sales performance, service |
| [processes.json](processes.json) | The same model as data, read by the Fit-gap sub-agent; the pages are generated from it |
| [sources.json](sources.json) | Every official source with the words quoted from it and the date it was last confirmed |

## How a component is placed on a step

1. **Its own name** matches a named pattern in the capability catalogue (`src/agents/assessment/capabilities.json`): high confidence.
2. **A standard object of a step**: the component sits on it (a field on Account), is triggered by it, or refers to it (a lookup): medium confidence.
   - a field on that object **extends the standard** (retain);
   - code, flows or rules on it are **custom logic on the standard step** (review: does the standard or configuration already cover it?);
   - a custom object linked to it is **built next to the standard** (review: possible duplicate).
3. **A keyword of a step** in its name (for example `Planogram`, `Trip_List`): low confidence. Keywords are matching aids chosen by the team, not sourced statements; they are written to avoid known false matches (`Visit` does not match `LiveChatVisitor`).
4. Otherwise the **business area of the objects it uses**, or not placed.

Each component keeps how it was placed, so the End-to-end validation view can show it and an expert can confirm or
change the result.

## Keeping it correct

- Add or change a step in [processes.json](processes.json) with at least one official source; add the source's quoted words to [sources.json](sources.json).
- Run `node --use-system-ca src/generators/verify-kb-sources.js` (opens every source in a browser and confirms the words) and `node src/generators/emit-kb-processes.js` (regenerates the pages).
- Object API names in the steps are the matching keys; where an official page names the feature but not the API name, the API name is the documented Salesforce object of that feature.
