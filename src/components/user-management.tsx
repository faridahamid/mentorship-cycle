"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, Search, Shield, Trash2, UserCog } from "lucide-react";
import { createAccount, resetUserPassword, setUserRole, deleteAccount } from "@/app/actions/admin";
import { CategoryPicker, Modal, Msg, Pagination } from "@/components/ui";

export interface ProfileUser {
  id: string;
  full_name: string;
  email: string;
  role: "super_admin" | "admin" | "mentor";
  created_at: string;
}

const ROLE_RANK: Record<string, number> = {
  super_admin: 2,
  admin: 1,
  mentor: 0,
};

export function UserManagement({
  users,
  currentUserId,
  currentUserRole = "admin",
  categories,
  locations
}: {
  users: ProfileUser[];
  currentUserId: string;
  currentUserRole?: "super_admin" | "admin" | "mentor";
  categories: { id: string; name: string; color: string }[];
  locations: { id: string; building: string; floor: number; section: string }[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  // Create state
  const [createOpen, setCreateOpen] = useState(false);
  const [role, setRole] = useState<"mentor" | "admin">("admin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selCats, setSelCats] = useState<string[]>([]);
  const [locId, setLocId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Role change state
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [targetUser, setTargetUser] = useState<ProfileUser | null>(null);
  const [newRole, setNewRole] = useState<"mentor" | "admin" | "super_admin">("admin");

  // Reset password state
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwTarget, setPwTarget] = useState<ProfileUser | null>(null);
  const [newPw, setNewPw] = useState("");

  // Delete account state
  const [delOpen, setDelOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<ProfileUser | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return users.filter((u) => {
      const matchSearch =
        !q ||
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q);
      const matchRole = roleFilter === "all" || u.role === roleFilter;
      return matchSearch && matchRole;
    });
  }, [users, search, roleFilter]);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const pagedUsers = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  function openCreate() {
    setRole(currentUserRole === "super_admin" ? "admin" : "mentor");
    setFullName("");
    setEmail("");
    setPassword("");
    setSelCats(categories.length > 0 ? [categories[0].id] : []);
    setLocId("");
    setErr(null);
    setCreateOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const r = await createAccount({
      role,
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      categoryIds: role === "mentor" ? selCats : [],
      locationId: role === "mentor" ? (locId || null) : null
    });
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setCreateOpen(false);
      router.refresh();
    }
  }

  async function handleRoleChange(e: React.FormEvent) {
    e.preventDefault();
    if (!targetUser) return;
    setLoading(true);
    setErr(null);
    const r = await setUserRole(targetUser.id, newRole);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setRoleModalOpen(false);
      setTargetUser(null);
      router.refresh();
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwTarget) return;
    setLoading(true);
    setErr(null);
    const r = await resetUserPassword(pwTarget.id, newPw);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setPwModalOpen(false);
      setPwTarget(null);
      setNewPw("");
      router.refresh();
    }
  }

  async function handleConfirmDelete() {
    if (!delTarget) return;
    setLoading(true);
    setErr(null);
    const r = await deleteAccount(delTarget.id);
    setLoading(false);
    if (!r.ok) {
      setErr(r.error);
    } else {
      setDelOpen(false);
      setDelTarget(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {/* Control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="searchBox">
            <Search className="h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search accounts..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <select
            className="input !w-auto !py-1.5 !text-xs font-mono"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All Roles ({users.length})</option>
            <option value="super_admin">Super Admins</option>
            <option value="admin">Admins</option>
            <option value="mentor">Mentors</option>
          </select>
        </div>

        <button onClick={openCreate} className="btn-primary !py-2 !px-4 text-xs font-bold">
          <Plus className="h-3.5 w-3.5" /> Create Account
        </button>
      </div>

      {/* Accounts List Panel */}
      <div className="panel overflow-hidden">
        <div className="panelHead">
          <div className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-cyan" />
            <h2>System Accounts & Profiles ({filtered.length})</h2>
          </div>
          <span className="monoLabel">{users.length} REGISTERED PROFILES</span>
        </div>

        {filtered.length > 0 ? (
          <>
            <div className="divide-y divide-line">
              {pagedUsers.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <div
                    key={u.id}
                    className="p-4 flex flex-wrap items-center justify-between gap-4 hover:bg-white/[0.02] transition"
                  >
                    <div className="space-y-0.5 min-w-[220px]">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-cream">{u.full_name}</span>
                        {isSelf && (
                          <span className="chip border border-cream/30 bg-cream/10 text-cream text-[9px] font-mono">
                            YOU
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-xs text-muted">{u.email}</div>
                      <div className="font-mono text-[10px] text-muted/70">
                        Joined {new Date(u.created_at).toLocaleDateString()}
                      </div>
                    </div>

                    <div>
                      <span
                        className={`chip font-mono text-[10px] font-bold uppercase tracking-wider ${
                          u.role === "super_admin"
                            ? "border-orange/30 bg-orange/15 text-orange"
                            : u.role === "admin"
                            ? "border-cyan/30 bg-cyan/15 text-cyan"
                            : "border-emerald/30 bg-emerald/15 text-emerald"
                        }`}
                      >
                        {u.role.replace("_", " ")}
                      </span>
                    </div>

                    {(() => {
                      const canManage =
                        (ROLE_RANK[currentUserRole] ?? 0) > (ROLE_RANK[u.role] ?? 0) && !isSelf;

                      if (!canManage) {
                        return (
                          <div
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line/60 bg-white/[0.02] text-xs font-mono text-muted/60"
                            title={
                              isSelf
                                ? "Your own account"
                                : "Protected: equal or higher ranking account"
                            }
                          >
                            <Shield className="h-3.5 w-3.5 text-muted/40" />
                            <span>Protected</span>
                          </div>
                        );
                      }

                      return (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setTargetUser(u);
                              setNewRole(u.role);
                              setErr(null);
                              setRoleModalOpen(true);
                            }}
                            className="btn !py-1.5 !px-2.5 text-xs text-muted hover:text-white"
                            title="Change Role"
                          >
                            <Shield className="h-3.5 w-3.5 text-cyan" /> Role
                          </button>
                          <button
                            onClick={() => {
                              setPwTarget(u);
                              setNewPw("");
                              setErr(null);
                              setPwModalOpen(true);
                            }}
                            className="btn !py-1.5 !px-2.5 text-xs text-muted hover:text-white"
                            title="Reset Password"
                          >
                            <KeyRound className="h-3.5 w-3.5 text-amber" /> Password
                          </button>
                          <button
                            onClick={() => {
                              setDelTarget(u);
                              setErr(null);
                              setDelOpen(true);
                            }}
                            className="btn !py-1.5 !px-2 text-xs text-muted hover:text-red-400"
                            title="Delete User"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        ) : (
          <div className="p-12 text-center font-mono text-xs text-muted">
            No accounts match your criteria.
          </div>
        )}
      </div>

      {/* Create Account Modal */}
      <Modal
        open={createOpen}
        onClose={() => !loading && setCreateOpen(false)}
        title="Provision New Account"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}

          <div className="field">
            <label className="lbl">Account Role</label>
            {currentUserRole === "super_admin" ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole("admin")}
                  className={`btn !rounded-xl justify-center font-bold ${
                    role === "admin" ? "btn-primary" : ""
                  }`}
                >
                  Control Room Admin
                </button>
                <button
                  type="button"
                  onClick={() => setRole("mentor")}
                  className={`btn !rounded-xl justify-center font-bold ${
                    role === "mentor" ? "btn-primary" : ""
                  }`}
                >
                  Specialized Mentor
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-xl border border-line/60 bg-white/[0.02] flex items-center justify-between">
                <span className="font-bold text-xs text-cream">Specialized Mentor</span>
                <span className="font-mono text-[10px] text-muted">Admin provision mode</span>
              </div>
            )}
          </div>

          <div className="field">
            <label className="lbl">Full Name</label>
            <input
              required
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Sara Mahmoud"
            />
          </div>

          <div className="field">
            <label className="lbl">Email Address</label>
            <input
              required
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@spaceapps.org"
            />
          </div>

          <div className="field">
            <label className="lbl">Initial Password (min 8 chars)</label>
            <input
              required
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {role === "mentor" && (
            <>
              <div className="field">
                <label className="lbl">Mentor Specialties</label>
                <CategoryPicker
                  categories={categories}
                  value={selCats}
                  onChange={setSelCats}
                />
              </div>

              <div className="field">
                <label className="lbl">Assigned Station Location</label>
                <select
                  className="input"
                  value={locId}
                  onChange={(e) => setLocId(e.target.value)}
                >
                  <option value="">No station assigned</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.building} • Floor {l.floor} {l.section ? `• ${l.section}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setCreateOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Creating..." : "Create Account"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Role Change Modal */}
      <Modal
        open={roleModalOpen}
        onClose={() => !loading && setRoleModalOpen(false)}
        title="Change Account Authorization Role"
      >
        <form onSubmit={handleRoleChange} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <p className="text-sm text-cream">
            Update role for <b>{targetUser?.full_name}</b> ({targetUser?.email}):
          </p>

          <div className="field">
            <label className="lbl">Select Role</label>
            <select
              className="input font-mono"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "mentor" | "admin" | "super_admin")}
            >
              <option value="mentor">Mentor (Portal Access)</option>
              {currentUserRole === "super_admin" && (
                <>
                  <option value="admin">Admin (Control Room Access)</option>
                  <option value="super_admin">Super Admin (Full Governance)</option>
                </>
              )}
            </select>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setRoleModalOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Updating..." : "Update Role"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        open={pwModalOpen}
        onClose={() => !loading && setPwModalOpen(false)}
        title="Reset Account Password"
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <p className="text-sm text-cream">
            Enter a new password for <b>{pwTarget?.full_name}</b> ({pwTarget?.email}):
          </p>

          <div className="field">
            <label className="lbl">New Password (min 8 characters)</label>
            <input
              required
              type="password"
              className="input"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setPwModalOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Resetting..." : "Set New Password"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        open={delOpen}
        onClose={() => !loading && setDelOpen(false)}
        title="Delete Account"
      >
        <div className="space-y-4">
          {err && <Msg kind="error">{err}</Msg>}
          <p className="text-sm text-cream">
            Are you sure you want to permanently delete the account for <b>{delTarget?.full_name}</b> ({delTarget?.email})?
          </p>
          <p className="font-mono text-xs text-muted">
            This will terminate their Supabase auth login and associated profile. Historical cycle assignments remain preserved.
          </p>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-line">
            <button
              type="button"
              disabled={loading}
              onClick={() => setDelOpen(false)}
              className="btn"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleConfirmDelete}
              className="btn btn-danger"
            >
              {loading ? "Deleting..." : "Delete Account"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
