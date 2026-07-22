/**
 * Header.tsx — App header with brand, file info, and actions.
 *
 * Phase 3: menu dropdown wired with state, sidebar toggle, mode switching.
 * Phase 4-5: save button, tab switching, auth wired, cookmode toggle.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAppState, useAppDispatch } from '../state/AppContext.js';
import { useTrash } from '../hooks/useTrash.js';
import { useNotes } from '../hooks/useNotes.js';
import { useAuth } from '../hooks/useAuth.js';
import { useCookmode } from '../hooks/useCookmode.js';
import { useIsMobile } from '../hooks/useIsMobile.js';
import { mergeEditTime } from '../hooks/useEditTime.js';
import { stopSync, clearRevision } from '../sync.js';
import { db } from '../db.js';
import { setTheme, getTheme } from '../themes.js';

export default function Header() {
  const dispatch = useAppDispatch();
  const { activeNoteId, activeNoteContent, isDirty, isSystemNote, activeTab, sidebarMode, auth } = useAppState();
  const { saveNote, setContent } = useNotes();
  const { toggleTrash } = useTrash();
  const { showLogin, logout, isAuthEnabled } = useAuth();
  const { active: cookmodeActive, toggle: toggleCookmode } = useCookmode();
  const [saving, setSaving] = useState(false);

  // Theme state — initialised from <html data-theme>
  const [currentTheme, setCurrentTheme] = useState(getTheme);

  // ── Mobile detection ──
  const isMobile = useIsMobile();

  // ── Mobile tab dropdown ──
  const [tabDropdownOpen, setTabDropdownOpen] = useState(false);
  const headerCenterRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!tabDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (headerCenterRef.current && !headerCenterRef.current.contains(e.target as Node)) {
        setTabDropdownOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [tabDropdownOpen]);

  const handleTabSelect = useCallback((tab: 'view' | 'code' | 'meta') => {
    dispatch({ type: 'SET_ACTIVE_TAB', tab });
    setTabDropdownOpen(false);
  }, [dispatch]);

  // Ref to read latest content in the async save handler.
  const contentRef = useRef(activeNoteContent);
  contentRef.current = activeNoteContent;

  // ── Theme list ──
  const THEMES = useMemo(() => ['dark', 'light', 'magenta', 'paired-12'] as const, []);

  // ── Menu handlers ──
  const handleModeChange = useCallback((value: string) => {
    if (value === 'trash') {
      toggleTrash();
    } else {
      if (sidebarMode === 'trash') toggleTrash();
      dispatch({ type: 'SET_SIDEBAR_MODE', mode: value as 'notes' | 'tags' });
    }
  }, [sidebarMode, dispatch, toggleTrash]);

  const handleThemeSelect = useCallback((themeName: string) => {
    setTheme(themeName);
    setCurrentTheme(themeName);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    const app = document.getElementById('app');
    if (!app) return;
    if (isMobile) {
      app.classList.toggle('sidebar-open');
    } else {
      app.classList.toggle('sidebar-collapsed');
    }
  }, [isMobile]);

  // ── Save handler ──

  const handleSave = useCallback(async () => {
    if (!activeNoteId || isSystemNote || saving) return;
    setSaving(true);
    try {
      const content = mergeEditTime(contentRef.current ?? '');
      await saveNote(activeNoteId, content);
      dispatch({ type: 'ADD_TOAST', id: `save-${Date.now()}`, message: `Saved "${activeNoteId}"` });
      dispatch({ type: 'SET_STATUS', status: `Saved "${activeNoteId}"` });
    } catch {
      dispatch({ type: 'ADD_TOAST', id: `save-err-${Date.now()}`, message: 'Save failed', isError: true });
    } finally {
      setSaving(false);
    }
  }, [activeNoteId, isSystemNote, saving, saveNote, dispatch]);

  // ── Reset Database ──
  const handleResetDB = useCallback(async () => {
    if (!confirm('This will delete all local data and re-download everything from the server. Continue?')) return;
    stopSync();
    clearRevision();
    try { await db.delete(); } catch (err) { console.warn('[reset] DB delete error:', err); }
    location.reload();
  }, []);

  // ── Hard Reload ──
  // Wipes browser caches and service worker, leaves IndexedDB (notes) intact.
  // Useful on mobile where Ctrl+Shift+R isn't available.
  const handleHardReload = useCallback(async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch { /* no-op */ }
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.unregister();
      }
    } catch { /* no-op */ }
    location.reload();
  }, []);

  const canSave = activeNoteId !== null && !isSystemNote && isDirty;

  // ── File name ──

  const fileName = activeNoteId || 'No file selected';

  return (
    <header id="header">
      {/* ── Brand + dropdown menu ── */}
      <div id="header-brand">
        <button
          id="btn-toggle-sidebar"
          className="btn-icon"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          onClick={handleToggleSidebar}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor"
               strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 18V6l7 6-7 6z"/>
          </svg>
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button id="btn-menu" className="btn-menu" title="Menu" aria-label="Menu">
              <span className="logo" aria-hidden="true">
                <svg width="13" height="13" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
                  <path d="M9 12h6m-6 4h6m2 4H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
                </svg>
              </span>
              {!isMobile && <span className="brand-text">Leaf</span>}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="app-dropdown"
              side="bottom"
              align="start"
              sideOffset={4}
            >
              <DropdownMenu.RadioGroup value={sidebarMode} onValueChange={handleModeChange}>
                <DropdownMenu.RadioItem value="notes" className="dropdown-item">
                  <DropdownMenu.ItemIndicator className="dropdown-check">✓</DropdownMenu.ItemIndicator>
                  <span>Folder</span>
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="tags" className="dropdown-item">
                  <DropdownMenu.ItemIndicator className="dropdown-check">✓</DropdownMenu.ItemIndicator>
                  <span>Tags</span>
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="trash" className="dropdown-item">
                  <DropdownMenu.ItemIndicator className="dropdown-check">✓</DropdownMenu.ItemIndicator>
                  <span>Trash</span>
                </DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
              <DropdownMenu.Separator className="dropdown-divider" />
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="dropdown-item">
                  Theme
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent className="app-dropdown" sideOffset={2} alignOffset={-4}>
                    <DropdownMenu.RadioGroup value={currentTheme} onValueChange={handleThemeSelect}>
                      {THEMES.map(t => (
                        <DropdownMenu.RadioItem key={t} value={t} className="dropdown-item">
                          <DropdownMenu.ItemIndicator className="dropdown-check">✓</DropdownMenu.ItemIndicator>
                          <span>{t === 'paired-12' ? 'Paired-12' : t.charAt(0).toUpperCase() + t.slice(1)}</span>
                        </DropdownMenu.RadioItem>
                      ))}
                    </DropdownMenu.RadioGroup>
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
              {/* ── Mobile-only: user + save + auth ── */}
              {isMobile && (
                <>
                  <DropdownMenu.Separator className="dropdown-divider" />
                  {isAuthEnabled && auth.username && (
                    <div className="dropdown-item dropdown-item-static">
                      👤 {auth.username}
                    </div>
                  )}
                  <DropdownMenu.Item
                    className="dropdown-item"
                    disabled={!canSave || saving}
                    onSelect={() => { if (canSave && !saving) handleSave(); }}
                  >
                    {saving ? '💾 Saving…' : '💾 Save'}
                    {isDirty && !saving && ' *'}
                  </DropdownMenu.Item>
                  {isAuthEnabled && !auth.username && !auth.showLogin && (
                    <DropdownMenu.Item className="dropdown-item" onSelect={() => showLogin()}>
                      🔑 Sign in
                    </DropdownMenu.Item>
                  )}
                  {isAuthEnabled && auth.username && (
                    <DropdownMenu.Item className="dropdown-item" onSelect={() => logout()}>
                      🚪 Sign out
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Separator className="dropdown-divider" />
                </>
              )}
              <DropdownMenu.Item className="dropdown-item" onSelect={() => handleResetDB()}>
                Reset Database
              </DropdownMenu.Item>
              <DropdownMenu.Item className="dropdown-item" onSelect={() => handleHardReload()}>
                Hard Reload
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button
          id="btn-cookmode"
          className={`btn-cookmode${cookmodeActive ? ' active' : ''}`}
          title={cookmodeActive ? 'Cookmode: ON — screen will stay awake' : 'Cookmode: OFF — click to keep screen awake'}
          aria-label="Toggle cookmode"
          aria-pressed={cookmodeActive}
          onClick={toggleCookmode}
        >
          ☀
        </button>
      </div>

      {/* ── Center: file name + dirty dot + mobile tab dropdown ── */}
      <div
        id="header-center"
        ref={headerCenterRef}
        className={tabDropdownOpen ? 'tab-dropdown-open' : ''}
      >
        <span id="current-file" onClick={() => setTabDropdownOpen(v => !v)}>{fileName}</span>
        <div id="dirty-dot" className={isDirty ? 'visible' : ''}
             title={isDirty ? 'Changes pending save…' : ''}></div>
        <div id="mobile-tab-dropdown" className="mobile-tab-dropdown">
          <button className="dropdown-item" onClick={() => handleTabSelect('view')}>
            <span className="dropdown-check">{activeTab === 'view' ? '✓' : ''}</span> View
          </button>
          <button className="dropdown-item" onClick={() => handleTabSelect('code')}>
            <span className="dropdown-check">{activeTab === 'code' ? '✓' : ''}</span> Code
          </button>
          <button className="dropdown-item" onClick={() => handleTabSelect('meta')}>
            <span className="dropdown-check">{activeTab === 'meta' ? '✓' : ''}</span> Meta
          </button>
        </div>
      </div>

      {/* ── Right: user + save + logout (hidden on mobile) ── */}
      <div id="header-actions" className={isMobile ? 'hidden-mobile' : ''}>
        {isAuthEnabled && <span id="username-display" className="username-display">{auth.username || ''}</span>}
        {isAuthEnabled && !auth.username && !auth.showLogin && (
          <button id="btn-signin" className="btn" onClick={showLogin}>
            Sign in
          </button>
        )}
        <button
          id="btn-save"
          className="btn btn-primary"
          title="Save now (Ctrl+S)"
          disabled={!canSave || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {isAuthEnabled && auth.username && (
          <button id="btn-logout" className="btn" title="Sign out" onClick={logout}>
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
