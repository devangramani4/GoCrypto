import { ALL_PERMISSIONS, type AdminRoleDto, PERMISSIONS, type Permission, type UserRole } from '@gocrypto/shared-types';
import { Alert, Badge, Button, ErrorState, Icon, cx } from '@gocrypto/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { ActionDialog } from '../components/ActionDialog';
import { BlockSkeleton } from '../components/feedback';
import { PageHeader, Panel } from '../components/PageHeader';
import { RoleBadge } from '../components/cells';
import { useApi } from '../lib/ApiContext';
import { errorMessage } from '../lib/errors';
import { useCan } from '../lib/permissions';
import { qk } from '../lib/queryKeys';
import { useSession } from '../lib/session';
import { humanize } from '../lib/status';
import { useAction } from '../lib/useAction';

export interface PermissionGroup {
  category: string;
  permissions: Permission[];
}

/** Group the catalogue by its category prefix ("users.freeze" -> "users"), keeping catalogue order. */
export function groupPermissions(perms: readonly Permission[] = ALL_PERMISSIONS): PermissionGroup[] {
  const groups: PermissionGroup[] = [];
  for (const p of perms) {
    const category = p.split('.')[0] ?? p;
    let g = groups.find((x) => x.category === category);
    if (!g) {
      g = { category, permissions: [] };
      groups.push(g);
    }
    g.permissions.push(p);
  }
  return groups;
}

const LOCKED_ROLE: UserRole = 'SUPER_ADMIN';

type Draft = Partial<Record<UserRole, Permission[]>>;

function sameSet(a: readonly Permission[], b: readonly Permission[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((p) => s.has(p));
}

/** Catalogue-ordered permission list (stable payloads and diffs). */
const ordered = (perms: Iterable<Permission>) => {
  const s = new Set(perms);
  return ALL_PERMISSIONS.filter((p) => s.has(p));
};

export interface RoleChange {
  role: AdminRoleDto;
  permissions: Permission[];
  added: Permission[];
  removed: Permission[];
}

export function roleChanges(roles: AdminRoleDto[], draft: Draft): RoleChange[] {
  const out: RoleChange[] = [];
  for (const role of roles) {
    const next = draft[role.code];
    if (!next || role.code === LOCKED_ROLE || sameSet(next, role.permissions)) continue;
    const before = new Set(role.permissions);
    const after = new Set(next);
    out.push({
      role,
      permissions: ordered(next),
      added: ordered(next.filter((p) => !before.has(p))),
      removed: ordered(role.permissions.filter((p) => !after.has(p))),
    });
  }
  return out;
}

export function RolesPage() {
  const client = useApi();
  const qc = useQueryClient();
  const can = useCan();
  const admin = useSession((s) => s.admin);
  const editable = can('roles.write');
  const query = useQuery({ queryKey: qk.roles, queryFn: () => client.admin.roles() });
  const [draft, setDraft] = useState<Draft>({});
  const [confirming, setConfirming] = useState(false);
  const groups = useMemo(() => groupPermissions(), []);

  const roles = useMemo(() => {
    const order = (r: AdminRoleDto) => (r.code === LOCKED_ROLE ? 0 : 1);
    return [...(query.data ?? [])].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  }, [query.data]);
  const changes = useMemo(() => roleChanges(roles, draft), [roles, draft]);
  const permsOf = (role: AdminRoleDto): Permission[] => (role.code === LOCKED_ROLE ? [...ALL_PERMISSIONS] : (draft[role.code] ?? role.permissions));

  const toggle = (role: AdminRoleDto, perm: Permission, on: boolean) =>
    setDraft((d) => {
      const current = new Set(d[role.code] ?? role.permissions);
      if (on) current.add(perm);
      else current.delete(perm);
      return { ...d, [role.code]: ordered(current) };
    });
  const setAll = (role: AdminRoleDto, perms: Permission[]) => setDraft((d) => ({ ...d, [role.code]: ordered(perms) }));

  const save = useAction<RoleChange[], AdminRoleDto[] | null>({
    mutationFn: async (list) => {
      let latest: AdminRoleDto[] | null = null;
      // Sequential so a failure leaves a well-defined state (earlier roles saved, later untouched).
      for (const c of list) latest = await client.admin.setRolePermissions(c.role.code, c.permissions);
      return latest;
    },
    success: (_d, list) => `Permissions updated for ${list.map((c) => c.role.name).join(', ')}`,
    // The admin's own role may have changed: refresh the session's permission set.
    invalidate: [qk.me],
    errorToast: false,
    onSuccess: (latest) => {
      if (latest) qc.setQueryData(qk.roles, latest);
      setDraft({});
      setConfirming(false);
    },
  });

  const ownChange = changes.find((c) => c.role.code === admin?.role);
  const selfLockout = ownChange?.removed.includes('roles.write') || ownChange?.removed.includes('roles.read');
  const totalColumns = ALL_PERMISSIONS.length;

  return (
    <div className="adm-page">
      <PageHeader
        title="Roles & permissions"
        subtitle="What each back-office role may see and do. Changes apply to every staff member with that role on their next request."
        actions={
          editable ? (
            <>
              <Button size="sm" variant="ghost" disabled={!changes.length || save.isPending} onClick={() => setDraft({})}>
                Discard
              </Button>
              <Button size="sm" variant="primary" disabled={!changes.length} onClick={() => setConfirming(true)}>
                Review & save{changes.length ? ` (${changes.length})` : ''}
              </Button>
            </>
          ) : (
            <Badge tone="warn">Read-only · requires roles.write</Badge>
          )
        }
      />
      {selfLockout && <Alert tone="error">You are removing roles permissions from your own role ({humanize(admin?.role ?? '')}). You will lose access to this page after saving.</Alert>}
      <Panel>
        {query.isPending ? (
          <BlockSkeleton rows={8} height={30} />
        ) : query.isError ? (
          <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <div className="adm-matrix-wrap">
            <table className="adm-matrix" aria-label="Role permission matrix">
              <thead>
                <tr>
                  <th className="adm-matrix__role" rowSpan={2} style={{ verticalAlign: 'bottom', paddingBottom: 8 }}>
                    Role
                  </th>
                  {groups.map((g) => (
                    <th key={g.category} colSpan={g.permissions.length} className="adm-matrix__group">
                      {humanize(g.category)}
                    </th>
                  ))}
                </tr>
                <tr>
                  {groups.map((g) =>
                    g.permissions.map((p, i) => (
                      <th key={p} className={cx(i === 0 && 'adm-matrix__group')} title={`${p} — ${PERMISSIONS[p]}`} scope="col">
                        {p.slice(g.category.length + 1)}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => {
                  const locked = role.code === LOCKED_ROLE;
                  const perms = new Set(permsOf(role));
                  const dirty = changes.some((c) => c.role.code === role.code);
                  const rowEditable = editable && !locked;
                  return (
                    <tr key={role.code} className={cx(dirty && 'adm-row--dirty')}>
                      <th className="adm-matrix__role" scope="row">
                        <div className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
                          <span className="row" style={{ gap: 6 }}>
                            <RoleBadge role={role.code} />
                            {locked && <Icon name="lock" size={13} className="faint" />}
                            {dirty && <Badge tone="brand">Edited</Badge>}
                          </span>
                          <span className="num faint" style={{ fontSize: 11 }}>
                            {perms.size}/{totalColumns}
                          </span>
                        </div>
                        <div className="adm-cell-sub adm-wrap" style={{ maxWidth: 260, fontWeight: 400 }}>
                          {locked ? 'Always holds every permission (not editable)' : (role.description ?? role.name)}
                        </div>
                        {rowEditable && (
                          <div className="row" style={{ gap: 4, marginTop: 4 }}>
                            <button type="button" className="adm-link-btn" style={{ fontSize: 11 }} onClick={() => setAll(role, [...ALL_PERMISSIONS])}>
                              All
                            </button>
                            <span className="faint">·</span>
                            <button type="button" className="adm-link-btn" style={{ fontSize: 11 }} onClick={() => setAll(role, ALL_PERMISSIONS.filter((p) => p.endsWith('.read')))}>
                              Read-only
                            </button>
                            <span className="faint">·</span>
                            <button type="button" className="adm-link-btn" style={{ fontSize: 11 }} onClick={() => setAll(role, [])}>
                              None
                            </button>
                          </div>
                        )}
                      </th>
                      {groups.map((g) => (
                        <Fragment key={g.category}>
                          {g.permissions.map((p, i) => (
                            <td key={p} className={cx('adm-matrix__cell', i === 0 && 'adm-matrix__group')}>
                              <input
                                type="checkbox"
                                aria-label={`${role.name}: ${p}`}
                                title={`${p} — ${PERMISSIONS[p]}`}
                                checked={perms.has(p)}
                                disabled={!rowEditable || save.isPending}
                                onChange={(e) => toggle(role, p, e.target.checked)}
                              />
                            </td>
                          ))}
                        </Fragment>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <ActionDialog
        open={confirming}
        wide
        title="Save role permissions"
        confirmLabel={`Save ${changes.length} role${changes.length === 1 ? '' : 's'}`}
        tone={selfLockout ? 'danger' : 'primary'}
        description={
          <div className="adm-stack" style={{ gap: 10 }}>
            <span>Staff with these roles gain or lose access immediately. The change is recorded in the audit log.</span>
            {changes.map((c) => (
              <div key={c.role.code} className="adm-muted-box">
                <div style={{ marginBottom: 6 }}>
                  <RoleBadge role={c.role.code} />
                </div>
                <div className="adm-chip-row">
                  {c.added.map((p) => (
                    <Badge key={p} tone="up">
                      + {p}
                    </Badge>
                  ))}
                  {c.removed.map((p) => (
                    <Badge key={p} tone="down">
                      − {p}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        }
        pending={save.isPending}
        error={save.error ? errorMessage(save.error) : null}
        onConfirm={() => save.mutate(changes)}
        onClose={() => {
          // After a partial failure, re-sync with the server before further edits.
          const failed = Boolean(save.error);
          save.reset();
          setConfirming(false);
          if (failed) void query.refetch();
        }}
      />
    </div>
  );
}
