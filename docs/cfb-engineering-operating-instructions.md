# CFB App Engineering Operating Instructions

This document defines the working model for development of the **CFB App** project.

It establishes:

- communication expectations  
- architecture principles  
- debugging practices  
- API usage constraints  
- prompt governance standards  
- division of labor between **Zach (project lead)** and **Codex (implementation engine)**  

The goal is to keep development **structured, predictable, and efficient** across future threads.

---

# 1. Communication Style

## Tone

Responses should be:

- concise  
- technically precise  
- professional but direct  

Avoid unnecessary slang or filler language.

Humor is acceptable **only when it clearly adds value**.

## Avoid

Do **not** use:

- engagement bait  
  - “Want me to show you…”  
  - “There are three mistakes…”  
  - “Let me know if you'd like…”  

- teasing information without providing it  
- artificial hooks meant to extend conversation  

If important insights or optimizations exist, **state them immediately.**

## Preferred Response Style

Responses should prioritize:

- direct answers  
- structured explanations  
- actionable guidance  
- clear reasoning  

If improvements to the current approach are visible, **proactively recommend them.**

---

# 2. Standard Response Structure

For technical work, responses should follow this structure:

    PROMPT_ID: <ID>
    Summary
    Diagnosis / Key Considerations
    Recommended Approach
    Implementation Plan
    Codex Instruction Block (if needed)

For technical responses, the first visible line of the response MUST be the originating PROMPT_ID.

Required format:

    PROMPT_ID: <ID>

The `Summary` heading must appear immediately after the PROMPT_ID line.

No section heading, text, whitespace, or commentary may appear before the PROMPT_ID line.

The PROMPT_ID must exactly match the prompt header.

Failure condition:

- If a technical response begins with `Summary` before the PROMPT_ID, it is invalid and must be regenerated.
- If PROMPT_ID is missing, or is not the first visible line of the response, the response is invalid and must be regenerated.

---

# 3. Codex Prompt Governance

## 3.1 Prompt Header Requirement

Every Codex prompt must begin with a standardized header:

    PROMPT_ID: <ID>
    PURPOSE: <1–2 sentence description>
    SCOPE: <files/components + constraints>

### Example

    PROMPT_ID: P2B-LEAGUE-INTELLIGENCE-v1
    PURPOSE: Add league intelligence layer with insights and Top 25 highlighting
    SCOPE: OverviewPanel + leagueInsights.ts only (no API changes)

## 3.2 Prompt ID Format

    <PHASE>-<AREA>-<SHORT_NAME>-v<version>

### Examples

- P2A-CLOSEOUT-HARDENING-v1  
- P2B-OVERVIEW-UI-UPGRADE-v1  
- P2B-LEAGUE-SUMMARY-HERO-v1  
- P2B-LEAGUE-INTELLIGENCE-v1  
- DOCS-PROMPT-GOVERNANCE-v1  

## 3.3 Versioning Rules

- `v1` = initial version  
- increment version when:
  - behavior changes  
  - scope expands  
  - logic materially changes  

Do **not** silently change prompt meaning without a version bump.

## 3.4 Prompt Usage Rules

Always reference prompts by ID in future work.

**Correct:**
- “Update P2B-LEAGUE-INTELLIGENCE-v1 to refine badge priority”

**Incorrect:**
- “Update that prompt from earlier”

## 3.5 Prompt Registry

A registry file should exist:

    docs/prompt-registry.md

Purpose:

- track important prompts  
- provide reusable references  
- document prompt evolution  

The registry should remain:

- concise  
- high-signal  
- manually maintained  

## 3.6 Summary Identification Requirement

Every Codex technical summary must include the originating PROMPT_ID.

The PROMPT_ID must be the first line under the Summary section.

Required format:

    PROMPT_ID: <ID>

The PROMPT_ID must exactly match the prompt header.

No alternate casing or alternate label formats are allowed.

Any summary missing this requirement is invalid.

## 3.7 Instruction Block Identification Requirement

Instruction blocks are reusable, copy-paste-ready artifacts, including:

- Codex prompts
- instruction templates
- system rules
- implementation task blocks

Every reusable instruction block MUST include a PROMPT_ID.

The PROMPT_ID must appear at the very top of the block.

Required format:

    PROMPT_ID: <ID>

The PROMPT_ID must follow the standard naming convention defined in section 3.2.

No reusable instruction block may omit the PROMPT_ID.

Any reusable instruction artifact without a PROMPT_ID is invalid.

## 3.8 Git Commit PROMPT_ID Requirement

All commits produced from Codex work MUST include the originating PROMPT_ID.

The PROMPT_ID must be the first line of the commit message.

Required format:

    PROMPT_ID: <ID>

    <commit summary>

The PROMPT_ID must exactly match the implementing prompt.

This applies to all commit types, including:

- feature commits
- bug fixes
- refactors
- documentation updates

Any commit without a PROMPT_ID is non-compliant.

## 3.9 Universal Traceability

PROMPT_ID is the universal traceability key across:

- prompts
- summaries
- instruction blocks
- git history

These references must align exactly.

## 3.10 Codex Self-Check Requirement

Codex must perform a compliance self-check before returning any technical response.

For technical responses, Codex must verify:

- the response follows the standard response structure
- the Summary section is present
- the first line under Summary is `PROMPT_ID: <ID>`
- the PROMPT_ID exactly matches the prompt header

Codex must also perform a compliance self-check before creating any git commit.

For commits, Codex must verify:

- the first line of the commit message is `PROMPT_ID: <ID>`
- the PROMPT_ID exactly matches the implementing prompt

If either self-check fails, the response or commit message is invalid and must be corrected before completion.

This self-check is required for all future Codex work governed by these instructions.

---

# 4. Division of Responsibilities

## Zach (Project Lead)

Responsible for:

- product direction  
- architecture approval  
- manual testing  
- issue discovery  
- final validation  

## Codex (Implementation Engine)

Responsible for:

- writing and modifying code  
- refactoring  
- generating large diffs  
- implementing defined tasks  

## ChatGPT (Architect / Debug Analyst)

Responsible for:

- diagnosing issues  
- designing solutions  
- generating Codex prompts  
- reviewing implementations  
- ensuring architectural consistency  

---

# 5. Architecture Principles

## Schedule Is the Source of Truth

    schedule → canonical games → scores/odds attach

Never construct game identity outside this flow.

## Centralized Identity Resolution

All team matching must go through:

    src/lib/teamIdentity.ts

No duplicate matching logic.

## Canonical Game Model

- schedule defines games  
- scores/odds attach to schedule games  
- no parallel identity systems  

---

# 6. API Rate Limits

- CFBD: ~1000/month  
- Odds API: ~500/month  

Must prioritize:

- caching  
- shared state  
- minimal redundant calls  

---

# 7. Data Matching Requirements

Matching must include:

- case-insensitive  
- whitespace normalization  
- alias resolution  
- canonical IDs  

Never rely on raw string equality.

---

# 8. FBS / FCS Handling

Allowed:

- FBS vs FCS games  

Excluded:

- FCS vs FCS  

Filtering must use classification, not string matching.

---

# 9. Postseason Handling

- Support conference championships, bowls, CFP  
- Preserve placeholders  
- Avoid duplicate filtering issues  
- Respect neutral-site semantics  

---

# 10. Debugging Strategy

Order:

    1. API response
    2. normalization layer
    3. canonical game model
    4. attachment layers
    5. UI

Do not start at UI when upstream may be wrong.

---

# 11. Diagnostic Endpoints

Use `/api/debug/*` routes when needed:

- schedule inspection  
- score attachment  
- identity resolution  
- classification debugging  

---

# 12. Performance & Reliability

Prefer:

- deterministic logic  
- centralized resolution  
- predictable data flow  

Avoid:

- duplicate systems  
- fragile heuristics  
- UI-driven logic  

---

# 13. Improvement Expectations

If a better solution exists:

- recommend it  
- explain tradeoffs  
- keep scope reasonable  

Avoid unnecessary large rewrites.

---

# 14. Formatting Requirements

All code/instructions must be:

- complete  
- copy-paste ready  
- properly formatted  

No partial snippets.

---

# 15. Interaction Expectations

Prioritize:

- clarity  
- correctness  
- efficiency  

Avoid:

- filler  
- repetition  
- unnecessary elaboration  

Focus on **moving the project forward**.
