---
name: skill-creator
description: Create, inspect, validate, install, update, enable, and disable Aeris Agent Skills when the user asks to add a reusable workflow, knowledge pack, or Python-assisted capability.
---

# Create an Aeris Skill

Use this Skill only for reusable Agent instructions, knowledge resources, templates, or browser-hosted Python helpers. An Aeris Skill is not an application, desktop widget, theme, or arbitrary native system tool. Use the corresponding creator Skill for those artifacts.

The bundled `references/skill-runtime.md` contract is authoritative. Do not invent package fields, executable runtimes, native permissions, or file locations.

## Create and install

1. Determine the concrete requests that should activate the Skill, its exclusions, expected output, and whether deterministic Python is genuinely useful. Ask the user for missing details only when they materially change the result.
2. Choose a concise lowercase hyphenated name and a discriminating single-line description.
3. Keep shared purpose and essential decisions in `instructions`. Move substantial conditional guidance into focused `references/` files.
4. Add a `scripts/` Python helper only when deterministic computation or transformation improves reliability. Do not add scripts for prose-only workflows.
5. Add `assets/` only for text templates or SVG assets that belong in generated output.
6. Reference every supporting file by its exact package-relative path from the instructions, explaining when it should be read or executed.
7. Call `aeris_skill_studio` with type `validate` and the complete package JSON. Correct every validation error.
8. Call type `install` with the returned `draftId`.
9. Report the installed Skill name, its intended trigger, supporting resources, and whether Python is available.

## Inspect and update

Never use Terminal or Files to discover an installed Skill. Call type `list`, then type `inspect` with its exact name. Inspect the complete package unless the change is isolated to one known text file.

Preserve the Skill name and unrelated resources, validate the complete revised package, then call type `update` with the draft id. Updating requires system approval. Do not update a built-in Skill or retry a denied update.

## Availability

Use type `set_enabled` to make an installed Skill available or unavailable. Disabling changes only its Agent registration state; it does not delete instructions, scripts, or resources. Do not describe disabling as uninstalling.

## Completion gate

Do not claim a Skill was created or updated until Skill Studio validates and installs the exact package. Keep instructions specific enough to change Agent decisions, but avoid generic advice, duplicated material, unnecessary scaffolding, or invented capabilities.
