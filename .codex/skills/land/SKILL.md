---
name: land
description: Merge an approved PR, move the Linear ticket to Done, and clean up the branch. Use this skill when a ticket reaches the Merging state.
---

# Land Skill

Merge an approved PR and close the associated Linear ticket.

## Steps

1. **Verify PR is ready**
   - Run `gh pr view` to confirm the PR exists and is open
   - Run `gh pr checks` to confirm CI is passing
   - If checks are failing, note in workpad and stop — do NOT merge a failing PR

2. **Merge the PR**
   - Run: `gh pr merge --squash --delete-branch`
   - This squash-merges the branch into main and deletes the feature branch
   - If the PR has merge conflicts, resolve them on the branch, force-push, then retry

3. **Confirm merge**
   - Run `gh pr view` again to confirm state is `MERGED`

4. **Move ticket to Done**
   - Update the Linear issue state to `Done` using `linear_graphql` or the Linear MCP tool
   - Update the workpad comment with merge confirmation and close it out

5. **Done**
   - No further actions required
