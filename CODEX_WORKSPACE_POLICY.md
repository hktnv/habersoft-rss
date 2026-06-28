# Codex Workspace Policy

Status: `MS-020E_CODEX_WORKSPACE_HYGIENE_ACTIVE`.

This policy controls Codex-created temporary project artifacts for this repository. It does not move the canonical repository, production checkout, historical Desktop worktrees, legacy tombstone, `.md`, `operator-state`, production dumps, or user data.

## Required Workplace Root

New Codex temporary workspaces, clones, Git worktrees, test folders, build outputs, package outputs, and task caches for this project must be created only under:

```text
E:\Codex\rss-habersoft-com\workplace\
```

Each milestone must create a unique task-specific subdirectory under that root before cloning, creating worktrees, running package managers, or generating test/build/cache output. The task root must be normalized and prefix-validated before use.

Where a tool allows it, task-local temporary/cache variables must point under the task root, including:

```text
TMP
TEMP
npm_config_cache
```

C: drive and Windows Desktop are forbidden for new Codex-created project temporary workspaces, clones, Git worktrees, test folders, build outputs, package outputs, and task caches. Future agents must not use historical C:/Desktop paths as active workspace instructions.

Historical C:/Desktop references in older reports, denylist tests, or legacy notes remain historical only. They are not authorization to create new project artifacts there.

## Safe Cleanup Algorithm

Successful autonomous Git delivery requires cleanup of only the current task-specific E: directory after final remote refs are recorded. Cleanup must never target C:, Desktop, legacy tombstone paths, old audit worktrees, user data, production evidence, dumps, `.md`, `operator-state`, or anything outside the current task root.

Required cleanup algorithm:

```text
WORKPLACE_ROOT = E:\Codex\rss-habersoft-com\workplace
TASK_ROOT = WORKPLACE_ROOT\<milestone-specific-directory>
normalize(WORKPLACE_ROOT)
normalize(TASK_ROOT)
assert TASK_ROOT starts with WORKPLACE_ROOT + path separator
assert TASK_ROOT != WORKPLACE_ROOT
assert TASK_ROOT is not drive root / user profile / Desktop / repository root
record final branch/SHA/remote refs
remove only TASK_ROOT
verify TASK_ROOT no longer exists
never use wildcard deletes from WORKPLACE_ROOT
never delete outside TASK_ROOT
```

If a task is blocked or fails before successful delivery, preserve only the current task-specific E: directory when it is useful for audit and report its exact path. Do not clean outside it.

If successful delivery is complete but validated task-root deletion is blocked by locks or path-safety refusal, report `SUCCESS_WITH_CLEANUP_BLOCKER` and the exact path. Do not broaden cleanup.

## Boundaries

- Production SSH/curl/restart/pull/deploy remains out of scope.
- Registry publication, Git tag, GitHub Release, and image publication remain out of scope.
- Backend source/API/CORS/Prisma/package/version changes remain out of scope for this policy.
- Frontend product/runtime source changes remain out of scope for this policy.
- Admin UI production activation and Tenant/admin auth/session remain separate operator-authorized work.
- Long-term stability remains `NOT_APPLICABLE_BY_GOVERNANCE_DECISION` and is not proposed by this policy.
