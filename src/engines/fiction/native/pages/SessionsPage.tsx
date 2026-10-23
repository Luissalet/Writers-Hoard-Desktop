import { Fragment, useEffect, useRef, useState } from "react";
import { Check, Download, Pencil, Plus, Sparkles, Users, X } from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { Lang } from "../lib/i18n";
import { t } from "../lib/i18n";
import { useCopilotRefresh, useFormSnapshot } from "../lib/copilot";
import { changedFields, filledFields } from "../lib/copilot-context";
import type { Session, SessionWithDetails, World } from "../lib/types";
import { EmptyState, ErrorBanner } from "../components/ui";
import { SessionDetailsForm, type SessionPreparationDraft } from './SessionDetailsForm';

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SessionsPage({ world, lang }: { world: World; lang: Lang }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pendingWrite = useRef(false);
  const [details, setDetails] = useState<SessionWithDetails[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newMode, setNewMode] = useState<'start' | 'plan'>('start');
  // Only the expanded form is mounted. Private drafts remain in this page's
  // memory, keyed by world/session, without registering hidden copilot editors.
  const preparationDrafts = useRef(new Map<string, { snapshot: SessionPreparationDraft; owner: object }>());

  function reload(silent = false) {
    if (!silent) setSessions(null);
    return api.listSessionDetails(world.id)
      .then((result) => {
        setDetails(result.sessions);
        setSessions(result.sessions.map(row => row.session));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id]);

  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useCopilotRefresh(() => reload(true));
  useFormSnapshot("session-new", null, () => (creating ? filledFields({ title: newTitle }) : null));
  useFormSnapshot("session-form", renamingId, () => {
    const current = sessions?.find((s) => s.id === renamingId);
    return renamingId && current ? changedFields({ title: current.title || "" }, { title: renameValue }) : null;
  });

  async function createSession() {
    if (pendingWrite.current) return;
    pendingWrite.current = true;
    setBusy("new-session");
    setError(null);
    try {
      if (newMode === 'plan') {
        const planned = await api.planSession(world.id, newTitle.trim());
        setExpanded(planned.session.id);
      } else {
        await api.startSession(world.id, newTitle.trim());
      }
      setNewTitle("");
      setCreating(false);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      pendingWrite.current = false;
      setBusy(null);
    }
  }

  function startRename(s: Session) {
    if (pendingWrite.current) return;
    setRenamingId(s.id);
    setRenameValue(s.title || "");
  }

  async function saveRename(id: string) {
    if (!renameValue.trim() || pendingWrite.current) return;
    pendingWrite.current = true;
    setBusy(`${id}:rename`);
    setError(null);
    try {
      await api.renameSession(world.id, id, renameValue.trim());
      setRenamingId(null);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      pendingWrite.current = false;
      setBusy(null);
    }
  }

  async function exportChapter(session: Session, polish = false) {
    setBusy(polish ? `${session.id}:polish` : session.id);
    setNotice(null);
    setError(null);
    try {
      const result = await api.chapter(world.id, session.id, polish);
      downloadText(`${session.title || session.id}${result.polished ? " (pulido)" : ""}.md`, result.text);
      // Say plainly when the model was not used, and why.
      if (polish && !result.polished) setNotice(`${t("export_polish_fallback", lang)}: ${result.reason}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportBible() {
    setBusy("bible");
    try {
      downloadText(`${world.name}.md`, await api.bibleMarkdown(world.id, false));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function exportWorldJson() {
    setBusy("world-json");
    try {
      const data = await api.worldExportJson(world.id);
      downloadJson(`${world.name || world.id}.json`, data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportRecap(row: SessionWithDetails, draft: boolean) {
    setError(null);
    try { downloadText(`${row.session.title || row.session.id}${draft ? ' (borrador)' : ''}.md`, await api.sessionRecap(world.id, row.session.id, draft)); }
    catch (failure) { setError(failure instanceof ApiError ? failure.message : String(failure)); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>{t("nav_sessions", lang)}</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-primary" disabled={busy === "new-session"} onClick={() => { setNewMode('plan'); setCreating(true); }}>
            <Plus size={13} /> {t('session_plan', lang)}
          </button>
          <button className="btn btn-sm" disabled={busy === "new-session"} onClick={() => { setNewMode('start'); setCreating(true); }}>
            <Plus size={13} /> {t('session_start_now', lang)}
          </button>
          <button className="btn btn-sm" disabled={busy === "bible"} onClick={exportBible}>
            <Download size={13} /> {t("export_bible", lang)}
          </button>
          <button className="btn btn-sm" disabled={busy === "world-json"} onClick={exportWorldJson}>
            <Download size={13} /> {t("export_json", lang)}
          </button>
        </div>
      </div>

      {creating && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            autoFocus
            value={newTitle}
            disabled={busy === 'new-session'}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t("sessions_new_title_placeholder", lang)}
            aria-label={t("sessions_new_title_placeholder", lang)}
            onKeyDown={(e) => e.key === "Enter" && createSession()}
            style={{ flex: 1 }}
          />
          <button className="btn btn-sm btn-primary" disabled={busy === "new-session"} onClick={createSession}>
            <Check size={13} />{t(newMode === 'plan' ? 'session_plan' : 'session_start_now', lang)}
          </button>
          <button className="btn btn-sm" disabled={busy === 'new-session'} aria-label={t('session_cancel', lang)} onClick={() => { setCreating(false); setNewTitle(""); }}>
            <X size={13} />
          </button>
        </div>
      )}

      {error && <div style={{ marginBottom: 8 }}><ErrorBanner message={error} /></div>}
      {notice && <p className="notice" style={{ marginBottom: 8 }}>{notice}</p>}
      {sessions === null && <p>{t("loading", lang)}</p>}
      {sessions && sessions.length === 0 && <EmptyState icon={<Users size={28} />}>{t("sessions_empty", lang)}</EmptyState>}

      {sessions && sessions.length > 0 && (
        <table className="simple session-list">
          <thead>
            <tr>
              <th>{lang === "es" ? "Título" : "Title"}</th>
              <th>{lang === "es" ? "Inicio" : "Started"}</th>
              <th>{lang === "es" ? "Fin" : "Ended"}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => {
              const row = details.find(item => item.session.id === s.id)!;
              return <Fragment key={s.id}><tr>
                <td>
                  {renamingId === s.id ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        autoFocus
                        value={renameValue}
                        disabled={busy === `${s.id}:rename`}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveRename(s.id)}
                        style={{ flex: 1 }}
                        aria-label={t("sessions_rename_title", lang)}
                      />
                      <button className="icon-button" disabled={busy === `${s.id}:rename`} onClick={() => saveRename(s.id)}>
                        <Check size={13} />
                      </button>
                      <button className="icon-button" onClick={() => setRenamingId(null)}>
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {s.title || s.id}
                      <button
                        className="icon-button"
                        title={t("sessions_rename", lang)}
                        aria-label={t("sessions_rename", lang)}
                        onClick={() => startRename(s)}
                      >
                        <Pencil size={12} />
                      </button>
                    </span>
                  )}
                  <p className="session-prep-muted">{row.details ? t(`session_${row.details.status}`, lang) : t('session_unclassified', lang)}</p>
                  {row.is_current && <p className="session-prep-muted">{t('session_current', lang)}</p>}
                  {row.details?.scheduled_at != null && <p className="session-prep-muted">{new Date(row.details.scheduled_at * 1000).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US')}</p>}
                  {row.details?.hook && <p className="session-hook">{row.details.hook}</p>}
                </td>
                <td data-label={lang === 'es' ? 'Inicio' : 'Started'}>{new Date(s.started_at * 1000).toLocaleString(lang === "es" ? "es-ES" : "en-US")}</td>
                <td data-label={lang === 'es' ? 'Fin' : 'Ended'}>{s.ended_at ? new Date(s.ended_at * 1000).toLocaleString(lang === "es" ? "es-ES" : "en-US") : "—"}</td>
                <td>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: 'wrap' }}>
                    <button className="btn btn-sm" aria-expanded={expanded === s.id} onClick={() => setExpanded(expanded === s.id ? null : s.id)}>{t('session_details', lang)}</button>
                    <button className="btn btn-sm" disabled={busy === s.id} onClick={() => exportChapter(s)}>
                      <Download size={13} /> {t("export_chapter", lang)}
                    </button>
                    <button className="btn btn-sm" disabled={busy === `${s.id}:polish`} onClick={() => exportChapter(s, true)}
                      title={t("export_polish", lang)}>
                      <Sparkles size={13} className={busy === `${s.id}:polish` ? "spin" : ""} /> {t("export_polish", lang)}
                    </button>
                  </div>
                </td>
              </tr>{expanded === s.id && <tr><td colSpan={4}><SessionDetailsForm key={JSON.stringify([world.id, s.id])} row={row} worldId={world.id} lang={lang}
                remembered={preparationDrafts.current.get(JSON.stringify([world.id, s.id]))?.snapshot}
                onRemember={(snapshot, owner, onlyIfCurrent) => {
                  const key = JSON.stringify([world.id, s.id]);
                  // A completed request from a closed form cannot replace a
                  // newer draft entered after that session was reopened.
                  if (!onlyIfCurrent || preparationDrafts.current.get(key)?.owner === owner) preparationDrafts.current.set(key, { snapshot, owner });
                }}
                onSaved={() => reload(true)} onDownload={exportRecap} onClose={() => setExpanded(null)} /></td></tr>}</Fragment>;
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
