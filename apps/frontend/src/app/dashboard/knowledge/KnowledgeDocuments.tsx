'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ChevronDown, ChevronRight, Upload, FileText, Plus, Trash2, ArrowUp, ArrowDown, RefreshCw } from 'lucide-react';
import { MiniToggle } from './MiniToggle';

/**
 * Knowledge-base documents: upload a file (or type a note), then keep editing
 * the text the assistant actually reads. Only extracted text is stored — the
 * file itself is not kept — so "fix the wrong price" is an edit here rather than
 * a re-export upstream.
 */

export interface KnowledgeDoc {
  id: string;
  title: string;
  content: string;
  source: 'upload' | 'manual';
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  charCount: number;
}

/** Mirrors KNOWLEDGE_ACCEPT in the backend's knowledge-extract.ts. */
const ACCEPT = '.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.pdf,.docx';
/** Mirrors MAX_KNOWLEDGE_FILE_BYTES — rejected client-side so a big file isn't uploaded to fail. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** Mirrors MAX_PROMPT_DOC_CHARS — past this the prompt only gets the first documents. */
const PROMPT_BUDGET_CHARS = 20_000;

const DOCS_PATH = '/agent-config/knowledge/documents';

function formatBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeDocuments() {
  const { t } = useI18n();
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  // Per-document unsaved edits, keyed by id. A document not in here is clean.
  const [drafts, setDrafts] = useState<Record<string, { title: string; content: string }>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Set when the picked file should REPLACE a document instead of adding one.
  const replaceIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setDocs(await api.get<KnowledgeDoc[]>(DOCS_PATH));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.knowledge.docsLoadFailed', 'Failed to load documents'));
      setDocs([]);
    }
  }, [t]);
  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => { setNotice(msg); window.setTimeout(() => setNotice(''), 2000); };

  const replaceDoc = (doc: KnowledgeDoc) =>
    setDocs((list) => (list ?? []).map((d) => (d.id === doc.id ? doc : d)));

  const pickFile = (replaceId: string | null) => {
    replaceIdRef.current = replaceId;
    setError('');
    fileRef.current?.click();
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file) return;
    const replaceId = replaceIdRef.current;
    replaceIdRef.current = null;
    if (file.size > MAX_FILE_BYTES) {
      setError(t('dash.knowledge.docTooLarge', 'File is too large (max 8 MB).'));
      return;
    }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (replaceId) {
        const updated = await api.upload<KnowledgeDoc>(`${DOCS_PATH}/${replaceId}/file`, fd, 'PUT');
        replaceDoc(updated);
        // The stored text just changed under any open editor — drop the stale draft.
        setDrafts((d) => { const next = { ...d }; delete next[replaceId]; return next; });
        flash(t('dash.knowledge.docReplaced', 'Document updated from the new file.'));
      } else {
        const created = await api.upload<KnowledgeDoc>(`${DOCS_PATH}/upload`, fd, 'POST');
        setDocs((list) => [...(list ?? []), created]);
        setOpenId(created.id);
        flash(t('dash.knowledge.docUploaded', 'Document uploaded.'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.knowledge.docUploadFailed', 'Upload failed'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = ''; // let the same file be picked again
    }
  };

  const addNote = async () => {
    setBusy(true); setError('');
    try {
      const created = await api.post<KnowledgeDoc>(DOCS_PATH, {
        title: t('dash.knowledge.newNoteTitle', 'Catatan baru'),
        content: '',
      });
      setDocs((list) => [...(list ?? []), created]);
      setOpenId(created.id);
      setDrafts((d) => ({ ...d, [created.id]: { title: created.title, content: created.content } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.knowledge.docSaveFailed', 'Save failed'));
    } finally { setBusy(false); }
  };

  const saveDoc = async (doc: KnowledgeDoc) => {
    const draft = drafts[doc.id];
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const updated = await api.put<KnowledgeDoc>(`${DOCS_PATH}/${doc.id}`, {
        title: draft.title, content: draft.content,
      });
      replaceDoc(updated);
      setDrafts((d) => { const next = { ...d }; delete next[doc.id]; return next; });
      flash(t('dash.knowledge.docSaved', 'Document saved.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.knowledge.docSaveFailed', 'Save failed'));
    } finally { setBusy(false); }
  };

  const setEnabled = async (doc: KnowledgeDoc, enabled: boolean) => {
    replaceDoc({ ...doc, enabled }); // optimistic — the switch must feel instant
    try {
      replaceDoc(await api.put<KnowledgeDoc>(`${DOCS_PATH}/${doc.id}`, { enabled }));
    } catch (e) {
      replaceDoc({ ...doc, enabled: !enabled });
      setError(e instanceof Error ? e.message : t('dash.knowledge.docSaveFailed', 'Save failed'));
    }
  };

  const removeDoc = async (doc: KnowledgeDoc) => {
    if (!window.confirm(t('dash.knowledge.docDeleteConfirm', 'Delete this document? The AI will stop using it.'))) return;
    setBusy(true); setError('');
    try {
      await api.delete(`${DOCS_PATH}/${doc.id}`);
      setDocs((list) => (list ?? []).filter((d) => d.id !== doc.id));
      setDrafts((d) => { const next = { ...d }; delete next[doc.id]; return next; });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('dash.knowledge.docDeleteFailed', 'Delete failed'));
    } finally { setBusy(false); }
  };

  /** Swap a document with its neighbour — order decides what survives the prompt budget. */
  const move = async (index: number, delta: -1 | 1) => {
    const list = docs ?? [];
    const other = index + delta;
    if (other < 0 || other >= list.length) return;
    const a = list[index]; const b = list[other];
    if (!a || !b) return;
    const next = [...list];
    next[index] = b; next[other] = a;
    setDocs(next);
    setBusy(true);
    try {
      await Promise.all([
        api.put(`${DOCS_PATH}/${a.id}`, { sortOrder: other }),
        api.put(`${DOCS_PATH}/${b.id}`, { sortOrder: index }),
      ]);
      await load();
    } catch (e) {
      setDocs(list);
      setError(e instanceof Error ? e.message : t('dash.knowledge.docSaveFailed', 'Save failed'));
    } finally { setBusy(false); }
  };

  const list = docs ?? [];
  const usedChars = list.filter((d) => d.enabled).reduce((sum, d) => sum + d.charCount, 0);
  const overBudget = usedChars > PROMPT_BUDGET_CHARS;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="section-title">{t('dash.knowledge.sectionDocsTitle', 'Knowledge documents')}</h2>
          <p className="section-description">
            {t('dash.knowledge.sectionDocsHelp', 'Upload a price list, terms sheet, or FAQ (PDF, Word, text). Only the text is stored — edit it here any time and the AI reads your edit.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary flex items-center gap-1.5" onClick={addNote} disabled={busy}>
            <Plus className="w-4 h-4" /> {t('dash.knowledge.addNote', 'Add note')}
          </button>
          <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => pickFile(null)} disabled={busy}>
            <Upload className="w-4 h-4" /> {busy ? t('dash.knowledge.uploading', 'Uploading…') : t('dash.knowledge.uploadFile', 'Upload file')}
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid="knowledge-doc-file"
        onChange={(e) => onFilePicked(e.target.files?.[0])}
      />

      {error && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mt-3 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">{notice}</div>}

      <div className="mt-3 space-y-2">
        {docs === null && <p className="text-sm text-text-muted">{t('dash.knowledge.loading', 'Loading…')}</p>}
        {docs !== null && list.length === 0 && (
          <p className="text-sm text-text-muted">
            {t('dash.knowledge.docsEmpty', 'No documents yet. Upload a file or add a note — the AI will use it when answering customers.')}
          </p>
        )}

        {list.map((doc, i) => {
          const draft = drafts[doc.id];
          const dirty = !!draft && (draft.title !== doc.title || draft.content !== doc.content);
          const open = openId === doc.id;
          return (
            <div key={doc.id} className="border border-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-sunken/40">
                <button
                  type="button"
                  className="text-text-muted hover:text-text-primary"
                  onClick={() => {
                    setOpenId(open ? null : doc.id);
                    if (!open && !drafts[doc.id]) setDrafts((d) => ({ ...d, [doc.id]: { title: doc.title, content: doc.content } }));
                  }}
                  aria-label={open ? t('dash.knowledge.hideDetails', 'Hide details') : t('dash.knowledge.showDetails', 'Show details')}
                >
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <FileText className={`w-4 h-4 shrink-0 ${doc.enabled ? 'text-primary-500' : 'text-text-muted'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium truncate ${doc.enabled ? 'text-text-primary' : 'text-text-muted'}`}>
                    {doc.title}{dirty && ' •'}
                  </p>
                  <p className="text-xs text-text-muted truncate">
                    {doc.fileName ? `${doc.fileName} · ${formatBytes(doc.sizeBytes)} · ` : ''}
                    {t('dash.knowledge.docChars', '{n} characters').replace('{n}', doc.charCount.toLocaleString())}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={t('dash.knowledge.moveUp', 'Move up')}>
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button type="button" className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30" disabled={busy || i === list.length - 1} onClick={() => move(i, 1)} aria-label={t('dash.knowledge.moveDown', 'Move down')}>
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button type="button" className="p-1 text-text-muted hover:text-red-600" disabled={busy} onClick={() => removeDoc(doc)} aria-label={t('dash.knowledge.docDelete', 'Delete')}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <MiniToggle checked={doc.enabled} onChange={(v) => setEnabled(doc, v)} />
                </div>
              </div>

              {open && (
                <div className="px-3 py-2.5 border-t border-border space-y-2">
                  <input
                    className="input-field text-sm"
                    value={draft?.title ?? doc.title}
                    onChange={(e) => setDrafts((d) => ({ ...d, [doc.id]: { title: e.target.value, content: d[doc.id]?.content ?? doc.content } }))}
                    aria-label={t('dash.knowledge.docTitleLabel', 'Document title')}
                  />
                  <textarea
                    className="input-field font-mono text-xs"
                    rows={12}
                    value={draft?.content ?? doc.content}
                    onChange={(e) => setDrafts((d) => ({ ...d, [doc.id]: { title: d[doc.id]?.title ?? doc.title, content: e.target.value } }))}
                    placeholder={t('dash.knowledge.docContentPlaceholder', 'The text the AI will read…')}
                    aria-label={t('dash.knowledge.docContentLabel', 'Document text')}
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={() => saveDoc(doc)}>
                      {t('dash.knowledge.docSave', 'Save document')}
                    </button>
                    <button type="button" className="btn-secondary flex items-center gap-1.5" disabled={busy} onClick={() => pickFile(doc.id)}>
                      <RefreshCw className="w-4 h-4" /> {t('dash.knowledge.docReplaceFile', 'Replace with file')}
                    </button>
                    {!doc.enabled && (
                      <span className="text-xs text-amber-600">
                        {t('dash.knowledge.docOffHint', 'This document is off — the AI is not reading it.')}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {list.length > 0 && (
        <p className={`mt-3 text-xs ${overBudget ? 'text-amber-600' : 'text-text-muted'}`}>
          {t('dash.knowledge.docsBudget', '{used} of {max} characters used by enabled documents.')
            .replace('{used}', usedChars.toLocaleString())
            .replace('{max}', PROMPT_BUDGET_CHARS.toLocaleString())}
          {overBudget && ` ${t('dash.knowledge.docsBudgetOver', 'Documents past the limit are left out — move the most important ones to the top.')}`}
        </p>
      )}
    </div>
  );
}
