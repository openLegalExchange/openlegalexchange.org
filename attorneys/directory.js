/**
 * OLE CLEAR Attorney Directory — Client-Side Search
 * /attorneys/directory.js
 *
 * Loads profiles from registered OLE network nodes (data/nodes.json).
 * For each node where directorySearch: true, fetches its directorySearchEndpoint
 * and merges results. Falls back to the local JSON when no live nodes are active.
 * To add a node: edit data/nodes.json and set directorySearch: true.
 * CORS requirement: live nodes must respond with Access-Control-Allow-Origin: *
 */

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────

  let allProfiles = [];
  let filteredProfiles = [];
  let debounceTimer = null;
  let activeFilters = {};
  let openModalProfile = null;
  let previousFocus = null;
  let hasSampleProfiles = false;

  // ─── DOM References ────────────────────────────────────────────────────────

  const els = {
    searchInput:      () => document.getElementById('dir-search-input'),
    searchClear:      () => document.getElementById('dir-search-clear'),
    filterState:      () => document.getElementById('filter-state'),
    filterCounty:     () => document.getElementById('filter-county'),
    filterPractice:   () => document.getElementById('filter-practice'),
    filterLanguage:   () => document.getElementById('filter-language'),
    filterCredential: () => document.getElementById('filter-credential'),
    filterAccepts:    () => document.getElementById('filter-accepts-referrals'),
    filterAttyToAtty: () => document.getElementById('filter-atty-to-atty'),
    filterClear:      () => document.getElementById('filter-clear-enabled'),
    resultsGrid:      () => document.getElementById('dir-results'),
    resultsCount:     () => document.getElementById('dir-results-count'),
    chips:            () => document.getElementById('dir-active-chips'),
    clearFiltersBtn:  () => document.getElementById('dir-clear-filters'),
    loadingEl:        () => document.getElementById('dir-loading'),
    errorEl:          () => document.getElementById('dir-error'),
    emptyEl:          () => document.getElementById('dir-empty'),
    emptyReset:       () => document.getElementById('dir-empty-reset'),
    modal:            () => document.getElementById('profile-modal'),
    modalPanel:       () => document.querySelector('.modal-panel'),
    modalTitle:       () => document.getElementById('modal-title'),
    modalEyebrow:     () => document.getElementById('modal-eyebrow'),
    modalFirm:        () => document.getElementById('modal-firm'),
    modalBody:        () => document.getElementById('modal-body'),
    modalCloseBtn:    () => document.getElementById('modal-close-btn'),
    modalCloseFooter: () => document.getElementById('modal-close-footer'),
    complianceInline: () => document.getElementById('dir-compliance-inline'),
  };

  // ─── Data Loading ─────────────────────────────────────────────────────────

  /**
   * Load profiles from registered OLE network nodes.
   * Reads data/nodes.json → fetches each active node's directorySearchEndpoint →
   * merges and de-duplicates results. Falls back to localFallback JSON if no
   * live nodes return data.
   */
  async function loadProfiles() {
    showState('loading');
    try {
      const basePath = getBasePath();

      // Load node registry
      let nodes = [];
      try {
        const nodesRes = await fetch(basePath + 'data/nodes.json');
        if (nodesRes.ok) nodes = (await nodesRes.json()).nodes || [];
      } catch (_) {
        console.warn('[OLE Directory] Could not load nodes.json — using built-in fallback');
      }

      const liveNodes = nodes.filter(n => n.directorySearch && n.directorySearchEndpoint);
      const fallbackNode = nodes.find(n => n.localFallback);

      const merged = [];
      let liveCount = 0;

      // Fetch each live OLE node in parallel (8s timeout per node)
      const nodeResults = await Promise.allSettled(
        liveNodes.map(async node => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          try {
            const res = await fetch(node.directorySearchEndpoint, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            // Nodes return { actors: [...] } per spec; also accept { profiles: [...] }
            const actors = data.actors || data.profiles || [];
            return actors
              .filter(p => p.visibility &&
                (p.visibility.scope === 'network_visible' || p.visibility.scope === 'public'))
              .map(p => normalizeProfile(p, node));
          } finally {
            clearTimeout(timer);
          }
        })
      );

      nodeResults.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          merged.push(...result.value);
          liveCount += result.value.length;
        } else {
          console.warn('[OLE Directory] Node failed:', liveNodes[i].provider, result.reason);
        }
      });

      // Fall back to local JSON if no live data came in
      if (liveCount === 0 && fallbackNode) {
        try {
          const res = await fetch(basePath + fallbackNode.localFallback);
          if (res.ok) {
            const data = await res.json();
            const profiles = (data.profiles || [])
              .filter(p => p.visibility &&
                (p.visibility.scope === 'network_visible' || p.visibility.scope === 'public'))
              .map(p => normalizeProfile(p, fallbackNode));
            merged.push(...profiles);
            console.info('[OLE Directory] No live nodes active — showing sample data fallback');
          }
        } catch (_) {
          console.warn('[OLE Directory] Local fallback also failed');
        }
      }

      // De-duplicate by id (same attorney may appear on multiple nodes)
      const seen = new Set();
      allProfiles = merged.filter(p => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });

      hasSampleProfiles = allProfiles.some(p => p.sampleProfile);
      updateSampleNotice();

      showState('results');
      applyFiltersAndRender();
    } catch (err) {
      console.error('[OLE Directory] Failed to load profiles:', err);
      showState('error');
    }
  }

  /**
   * Normalize a profile to the flat shape the renderer expects.
   * Handles two formats:
   *   - OLE network format (nested: name.display, jurisdiction.state, referralPreferences.*)
   *   - Local JSON format (flat: displayName, state, acceptsReferrals, ...)
   */
  function normalizeProfile(p, node) {
    const source = { provider: node.provider, nodeId: node.id };

    // Already flat (local JSON format)
    if (p.displayName) {
      return Object.assign({}, p, { _source: source });
    }

    // OLE network format — map nested fields to flat
    const name  = p.name || {};
    const jur   = p.jurisdiction || {};
    const prefs = p.referralPreferences || {};
    const cred  = p.credentialSummary || {};

    const displayName = name.display ||
      [name.given, name.family].filter(Boolean).join(' ') || p.id;

    const slug = displayName.toLowerCase()
      .replace(/[',\.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const credStatus = cred.credentialStatus || 'self_declared';
    const prefMethod = prefs.preferredReferralMethod === 'ole_clear'
      ? 'clear_packet' : (prefs.preferredReferralMethod || 'email');

    return {
      resourceType: 'DirectoryProfile',
      id:           p.id,
      oleVersion:   p.oleVersion || '0.1',
      module:       'clear',
      displayName,
      imageUrl:     (p.profile && p.profile.imageUrl) || p.imageUrl || null,
      slug,
      firmName:     name.display || displayName,
      city:         jur.city || '',
      county:       (jur.counties && jur.counties[0]) || '',
      state:        jur.state || '',
      country:      jur.country || 'US',
      practiceAreas:      p.practiceAreas || [],
      practiceAreaLabels: (p.practiceAreas || []).map(practiceAreaLabel),
      languages:      p.languages || [],
      languageLabels: (p.languages || []).map(languageLabel),
      acceptsReferrals:          prefs.acceptingReferrals || false,
      attorneyToAttorneyOnly:    prefs.attorneyToAttorneyOnly || false,
      clearEnabled:              prefs.clearEnabled || false,
      acceptsDirectConsumerContact: false,
      credentialStatus: credStatus,
      credentialSummary: {
        credentialType:     'bar_admission',
        jurisdiction:       cred.barState || jur.state || '',
        status:             'active',
        verifiedAt:         cred.verifiedAt || null,
        verificationSource: cred.verifiedAt ? 'public_bar_record' : 'self_declared',
      },
      referralPreferences: {
        requiresClientConsentBeforeTransmission: false,
        preferredReferralMethod: prefMethod,
        notes: prefs.notes || '',
      },
      contact:    p.contact || {},
      visibility: p.visibility || { scope: 'network_visible' },
      _source: source,
    };
  }

  /** Show or hide the sample data banner based on current profile set. */
  function updateSampleNotice() {
    const notice = document.getElementById('sample-data-notice');
    if (notice) notice.hidden = !hasSampleProfiles;
  }

  /** Derive the site root path from current location. */
  function getBasePath() {
    // Works for both /attorneys/ and nested paths
    const path = window.location.pathname;
    const depth = (path.match(/\//g) || []).length - 1;
    return depth > 0 ? '../'.repeat(depth) : './';
  }

  // ─── Filter & Search Logic ────────────────────────────────────────────────

  function collectFilters() {
    const q = (els.searchInput().value || '').trim().toLowerCase();
    return {
      q,
      state:              els.filterState().value,
      county:             els.filterCounty().value,
      practiceArea:       els.filterPractice().value,
      language:           els.filterLanguage().value,
      credentialStatus:   els.filterCredential().value,
      acceptsReferrals:   els.filterAccepts().checked,
      attorneyToAttorneyOnly: els.filterAttyToAtty().checked,
      clearEnabled:       els.filterClear().checked,
    };
  }

  function profileMatchesFilters(profile, filters) {
    // Full-text search across key text fields
    if (filters.q) {
      const searchable = [
        profile.displayName,
        profile.firmName,
        profile.city,
        profile.county,
        profile.state,
        ...(profile.practiceAreaLabels || []),
        ...(profile.languageLabels || []),
        (profile.referralPreferences && profile.referralPreferences.notes) || '',
      ].join(' ').toLowerCase();

      if (!searchable.includes(filters.q)) return false;
    }

    if (filters.state && profile.state !== filters.state) return false;
    if (filters.county && profile.county !== filters.county) return false;

    if (filters.practiceArea) {
      if (!profile.practiceAreas || !profile.practiceAreas.includes(filters.practiceArea)) return false;
    }

    if (filters.language) {
      if (!profile.languages || !profile.languages.includes(filters.language)) return false;
    }

    if (filters.credentialStatus && profile.credentialStatus !== filters.credentialStatus) return false;
    if (filters.acceptsReferrals && !profile.acceptsReferrals) return false;
    if (filters.attorneyToAttorneyOnly && !profile.attorneyToAttorneyOnly) return false;
    if (filters.clearEnabled && !profile.clearEnabled) return false;

    return true;
  }

  function applyFiltersAndRender() {
    activeFilters = collectFilters();
    filteredProfiles = allProfiles.filter(p => profileMatchesFilters(p, activeFilters));
    renderResults(filteredProfiles);
    renderChips(activeFilters);
    updateClearFiltersVisibility();
  }

  function triggerSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(applyFiltersAndRender, 300);
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  function renderResults(profiles) {
    const grid = els.resultsGrid();
    const countEl = els.resultsCount();
    const emptyEl = els.emptyEl();
    const compliance = els.complianceInline();

    grid.innerHTML = '';

    if (profiles.length === 0) {
      showState('empty');
      countEl.textContent = '';
      if (compliance) compliance.hidden = true;
      return;
    }

    showState('results');
    countEl.textContent = 'Showing ' + profiles.length + ' profile' + (profiles.length !== 1 ? 's' : '');
    if (compliance) compliance.hidden = false;

    const fragment = document.createDocumentFragment();
    profiles.forEach(profile => {
      fragment.appendChild(buildCard(profile));
    });
    grid.appendChild(fragment);
  }

  function buildCard(profile) {
    const article = document.createElement('article');
    article.className = 'dir-card';
    article.setAttribute('role', 'listitem');

    const credLabel = credentialLabel(profile.credentialStatus);
    const credClass = credentialClass(profile.credentialStatus);
    const verifiedDate = profile.credentialSummary && profile.credentialSummary.verifiedAt
      ? formatVerifiedDate(profile.credentialSummary.verifiedAt)
      : null;

    article.innerHTML = `
      <div class="dir-card-top">
        <div class="dir-card-identity">
          <div class="dir-card-avatar" aria-hidden="true">${avatarHtml(profile)}</div>
          <div>
            <h3 class="dir-card-name">${escHtml(profile.displayName)}</h3>
            <p class="dir-card-firm">${escHtml(profile.firmName)}</p>
            <p class="dir-card-location">${(()=>{ const loc=[profile.city,profile.county].filter(Boolean).join(', '); return escHtml(loc)+(loc?' · ':'')+escHtml(profile.state); })()}</p>
          </div>
        </div>
        <div class="dir-card-badges">
          ${profile.clearEnabled ? '<span class="dir-badge dir-badge-clear" title="Accepts CLEAR-formatted referral packets">CLEAR-enabled</span>' : ''}
          ${profile.acceptsReferrals ? '<span class="dir-badge dir-badge-open">Accepting referrals</span>' : '<span class="dir-badge dir-badge-closed">Not accepting</span>'}
        </div>
      </div>

      <dl class="dir-card-details">
        <div class="dir-card-detail-row">
          <dt>Practice areas</dt>
          <dd>${escHtml((profile.practiceAreaLabels || []).join(', '))}</dd>
        </div>
        <div class="dir-card-detail-row">
          <dt>Languages</dt>
          <dd>${escHtml((profile.languageLabels || []).join(', '))}</dd>
        </div>
        <div class="dir-card-detail-row">
          <dt>Referral type</dt>
          <dd>${profile.attorneyToAttorneyOnly ? 'Attorney-to-attorney only' : 'Attorneys &amp; legal organizations'}</dd>
        </div>
        ${profile.referralPreferences && profile.referralPreferences.notes ? `
        <div class="dir-card-detail-row dir-card-pref">
          <dt>Preference</dt>
          <dd>${escHtml(truncate(profile.referralPreferences.notes, 140))}</dd>
        </div>` : ''}
      </dl>

      <div class="dir-card-footer">
        <div class="dir-card-credential ${credClass}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <span>${credLabel}${verifiedDate ? ' · ' + verifiedDate : ''}</span>
        </div>
        <div class="dir-card-actions">
          <button class="btn-card-view" data-slug="${escHtml(profile.slug)}" aria-label="View referral profile for ${escHtml(profile.displayName)}">
            View referral profile
          </button>
          <button class="btn-card-referral" disabled aria-label="Send structured referral — coming soon">
            Send referral <span class="coming-soon-tag" aria-hidden="true">soon</span>
          </button>
        </div>        ${profile._source && !profile.sampleProfile ? `<div class="dir-card-source">via ${escHtml(profile._source.provider)}</div>` : ''}      </div>
    `;

    article.querySelector('.btn-card-view').addEventListener('click', () => openModal(profile));
    return article;
  }

  // ─── Active Filter Chips ──────────────────────────────────────────────────

  const filterLabels = {
    state:              v => 'State: ' + v,
    county:             v => 'County: ' + v,
    practiceArea:       v => practiceAreaLabel(v),
    language:           v => languageLabel(v),
    credentialStatus:   v => credentialLabel(v),
    acceptsReferrals:   ()  => 'Accepting referrals',
    attorneyToAttorneyOnly: () => 'Attorney-to-attorney',
    clearEnabled:       ()  => 'CLEAR-enabled',
  };

  function renderChips(filters) {
    const container = els.chips();
    container.innerHTML = '';
    let hasChips = false;

    Object.entries(filters).forEach(([key, value]) => {
      if (key === 'q') return; // text search is shown in the input
      if (!value) return;
      hasChips = true;
      const chip = document.createElement('button');
      chip.className = 'dir-chip';
      chip.setAttribute('aria-label', 'Remove filter: ' + filterLabels[key](value));
      chip.innerHTML = `${escHtml(filterLabels[key](value))} <span aria-hidden="true">×</span>`;
      chip.addEventListener('click', () => removeFilter(key));
      container.appendChild(chip);
    });

    // Also show text chip if there's a search query
    if (filters.q) {
      const chip = document.createElement('button');
      chip.className = 'dir-chip';
      chip.setAttribute('aria-label', 'Clear search: ' + filters.q);
      chip.innerHTML = `"${escHtml(filters.q)}" <span aria-hidden="true">×</span>`;
      chip.addEventListener('click', () => {
        els.searchInput().value = '';
        els.searchClear().hidden = true;
        applyFiltersAndRender();
      });
      container.insertBefore(chip, container.firstChild);
      hasChips = true;
    }
  }

  function removeFilter(key) {
    const boolKeys = ['acceptsReferrals', 'attorneyToAttorneyOnly', 'clearEnabled'];
    if (boolKeys.includes(key)) {
      document.getElementById('filter-' + kebab(key)).checked = false;
    } else {
      const mapping = {
        state: 'filter-state',
        county: 'filter-county',
        practiceArea: 'filter-practice',
        language: 'filter-language',
        credentialStatus: 'filter-credential',
      };
      const el = document.getElementById(mapping[key]);
      if (el) el.value = '';
    }
    applyFiltersAndRender();
  }

  function updateClearFiltersVisibility() {
    const f = activeFilters;
    const hasAny = f.q || f.state || f.county || f.practiceArea || f.language ||
      f.credentialStatus || f.acceptsReferrals || f.attorneyToAttorneyOnly || f.clearEnabled;
    els.clearFiltersBtn().hidden = !hasAny;
  }

  function resetAllFilters() {
    els.searchInput().value = '';
    els.searchClear().hidden = true;
    els.filterState().value = '';
    els.filterCounty().value = '';
    els.filterPractice().value = '';
    els.filterLanguage().value = '';
    els.filterCredential().value = '';
    els.filterAccepts().checked = false;
    els.filterAttyToAtty().checked = false;
    els.filterClear().checked = false;
    applyFiltersAndRender();
  }

  // ─── State Management ─────────────────────────────────────────────────────

  function showState(state) {
    const loading = els.loadingEl();
    const error = els.errorEl();
    const empty = els.emptyEl();
    const grid = els.resultsGrid();
    const count = els.resultsCount();

    loading.hidden = state !== 'loading';
    error.hidden   = state !== 'error';
    empty.hidden   = state !== 'empty';
    grid.hidden    = state === 'loading' || state === 'error' || state === 'empty';

    if (state !== 'results') {
      count.textContent = '';
    }
  }

  // ─── Modal ────────────────────────────────────────────────────────────────

  function openModal(profile) {
    openModalProfile = profile;
    previousFocus = document.activeElement;

    // Populate header
    els.modalEyebrow().textContent = profile.clearEnabled ? 'CLEAR-enabled · ' + profile.state : profile.state;
    els.modalTitle().textContent = profile.displayName;
    els.modalFirm().textContent = profile.firmName;

    // Populate body
    els.modalBody().innerHTML = buildModalBody(profile);

    // Show modal
    const modal = els.modal();
    modal.hidden = false;
    document.body.classList.add('modal-open');

    // Focus panel
    setTimeout(() => {
      const panel = els.modalPanel();
      if (panel) panel.focus();
    }, 50);

    // Update URL hash
    history.pushState({ modal: profile.slug }, '', '#' + profile.slug);
  }

  function closeModal() {
    const modal = els.modal();
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    openModalProfile = null;

    // Restore focus
    if (previousFocus && previousFocus.focus) {
      previousFocus.focus();
    }

    // Remove hash
    history.pushState({}, '', window.location.pathname + window.location.search);
  }

  function buildModalBody(profile) {
    const cred = profile.credentialSummary || {};
    const prefs = profile.referralPreferences || {};
    const verifiedDate = cred.verifiedAt ? formatVerifiedDate(cred.verifiedAt) : null;

    const credStatusLabel = credentialLabel(profile.credentialStatus);
    const verificationSource = {
      'public_bar_record': 'Public bar record',
      'self_declared': 'Self-declared by attorney',
    }[cred.verificationSource] || (cred.verificationSource || 'Not specified');

    const referralMethodLabel = {
      'clear_packet': 'CLEAR-formatted referral packet',
      'email': 'Email (OLE packet format accepted)',
      'api': 'API endpoint',
    }[prefs.preferredReferralMethod] || (prefs.preferredReferralMethod || 'Not specified');

    return `
      <section class="modal-section">
        <h3 class="modal-section-title">Jurisdiction &amp; location</h3>
        <dl class="modal-dl">
          <div><dt>City</dt><dd>${escHtml(profile.city)}</dd></div>
          <div><dt>County</dt><dd>${escHtml(profile.county)}</dd></div>
          <div><dt>State</dt><dd>${escHtml(profile.state)}</dd></div>
          <div><dt>Country</dt><dd>${escHtml(profile.country)}</dd></div>
        </dl>
      </section>

      <section class="modal-section">
        <h3 class="modal-section-title">Practice areas</h3>
        <ul class="modal-tag-list" aria-label="Practice areas">
          ${(profile.practiceAreaLabels || []).map(a => `<li class="modal-tag">${escHtml(a)}</li>`).join('')}
        </ul>
      </section>

      <section class="modal-section">
        <h3 class="modal-section-title">Languages</h3>
        <ul class="modal-tag-list" aria-label="Languages">
          ${(profile.languageLabels || []).map(l => `<li class="modal-tag">${escHtml(l)}</li>`).join('')}
        </ul>
      </section>

      <section class="modal-section">
        <h3 class="modal-section-title">Referral preferences</h3>
        <dl class="modal-dl">
          <div><dt>Accepting referrals</dt><dd>${profile.acceptsReferrals ? 'Yes' : 'No'}</dd></div>
          <div><dt>Referral type accepted</dt><dd>${profile.attorneyToAttorneyOnly ? 'Attorney-to-attorney only' : 'Attorneys and legal organizations'}</dd></div>
          <div><dt>Direct consumer contact</dt><dd>${profile.acceptsDirectConsumerContact ? 'Yes' : 'Not accepted via this directory'}</dd></div>
          <div><dt>CLEAR-enabled</dt><dd>${profile.clearEnabled ? 'Yes — accepts CLEAR-formatted referral packets' : 'Not yet CLEAR-enabled'}</dd></div>
          <div><dt>Preferred referral method</dt><dd>${escHtml(referralMethodLabel)}</dd></div>
          <div><dt>Client consent required</dt><dd>${prefs.requiresClientConsentBeforeTransmission ? 'Yes — required before transmitting referral data' : 'Not specified'}</dd></div>
          ${prefs.notes ? `<div class="modal-dl-full"><dt>Notes</dt><dd>${escHtml(prefs.notes)}</dd></div>` : ''}
        </dl>
      </section>

      <section class="modal-section">
        <h3 class="modal-section-title">Credential verification</h3>
        <dl class="modal-dl">
          <div><dt>Credential status</dt><dd class="${credentialClass(profile.credentialStatus)}">${credStatusLabel}</dd></div>
          <div><dt>Credential type</dt><dd>${escHtml(cred.credentialType === 'bar_admission' ? 'Bar admission' : (cred.credentialType || 'Not specified'))}</dd></div>
          <div><dt>Jurisdiction</dt><dd>${escHtml(cred.jurisdiction || 'Not specified')}</dd></div>
          <div><dt>Bar status</dt><dd>${escHtml(cred.status === 'active' ? 'Active' : (cred.status || 'Not specified'))}</dd></div>
          <div><dt>Verification source</dt><dd>${escHtml(verificationSource)}</dd></div>
          ${verifiedDate ? `<div><dt>Verified</dt><dd>${verifiedDate}</dd></div>` : ''}
        </dl>
        <p class="modal-credential-note">
          This credential summary does not replace independent attorney due diligence.
          OLE is not the authoritative bar record. Verify directly with the applicable state bar.
        </p>
      </section>

      <section class="modal-section">
        <h3 class="modal-section-title">What this attorney does not accept via this directory</h3>
        <ul class="modal-not-accepted-list">
          ${!profile.acceptsDirectConsumerContact ? '<li>Direct consumer or client contact via OLE Directory</li>' : ''}
          ${profile.attorneyToAttorneyOnly ? '<li>Referrals from non-attorney sources (via CLEAR)</li>' : ''}
          <li>Legal advice requests</li>
          <li>Emergency or crisis legal matters without prior attorney consultation</li>
        </ul>
      </section>

      <section class="modal-section modal-section-id">
        <h3 class="modal-section-title">Profile identifiers</h3>
        <dl class="modal-dl">
          <div><dt>Profile ID</dt><dd class="mono">${escHtml(profile.id)}</dd></div>
          <div><dt>OLE version</dt><dd>${escHtml(profile.oleVersion)}</dd></div>
          <div><dt>Module</dt><dd>${escHtml(profile.module)}</dd></div>
          ${profile.sampleProfile ? '<div><dt>Status</dt><dd class="sample-flag">Sample profile — not a real attorney</dd></div>' : ''}
        </dl>
      </section>
    `;
  }

  // ─── Focus Trap ───────────────────────────────────────────────────────────

  function getFocusableEls(container) {
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.closest('[hidden]') && !el.closest('[aria-hidden="true"]'));
  }

  function handleModalKeydown(e) {
    if (e.key === 'Escape') {
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = els.modalPanel();
    const focusable = getFocusableEls(panel);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function escHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function truncate(str, max) {
    if (!str || str.length <= max) return str;
    return str.slice(0, max).replace(/\s+\S*$/, '') + '…';
  }

  function initials(name) {
    return (name || '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  function avatarHtml(profile) {
    if (profile.imageUrl) {
      return `<img src="${escHtml(profile.imageUrl)}" alt="" class="dir-avatar-img" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
              <span class="dir-avatar-fallback" style="display:none">${escHtml(initials(profile.displayName))}</span>`;
    }
    return escHtml(initials(profile.displayName));
  }

  function formatVerifiedDate(iso) {
    if (!iso) return null;
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch (_) {
      return iso;
    }
  }

  function credentialLabel(status) {
    return {
      'verified': 'Florida Bar status verified',
      'pending_verification': 'Verification pending',
      'self_declared': 'Self-declared',
    }[status] || (status || 'Unknown');
  }

  function credentialClass(status) {
    return {
      'verified': 'cred-verified',
      'pending_verification': 'cred-pending',
      'self_declared': 'cred-self',
    }[status] || '';
  }

  function practiceAreaLabel(key) {
    const map = {
      hoa_disputes: 'HOA disputes',
      condominium_law: 'Condominium law',
      personal_injury: 'Personal injury',
      family_law: 'Family law',
      probate: 'Probate',
      estate_planning: 'Estate planning',
      real_estate: 'Real estate',
      immigration: 'Immigration',
      criminal_defense: 'Criminal defense',
      business_law: 'Business law',
      landlord_tenant: 'Landlord tenant',
      employment_law: 'Employment law',
      real_estate_litigation: 'Real estate litigation',
      civil_litigation: 'Civil litigation',
      trust_administration: 'Trust administration',
      civil_rights: 'Civil rights',
      commercial_closing: 'Commercial closing',
      residential_closing: 'Residential closing',
      entity_formation: 'Entity formation',
      guardianship: 'Guardianship',
      bankruptcy: 'Bankruptcy',
      evictions: 'Evictions',
      housing: 'Housing',
      contracts: 'Contracts',
      other: 'Other',
    };
    return map[key] || key;
  }

  function languageLabel(code) {
    const map = { en: 'English', es: 'Spanish', fr: 'French', ht: 'Creole', pt: 'Portuguese' };
    return map[code] || code;
  }

  function kebab(camel) {
    // camelCase to kebab-case for DOM id mapping
    const map = {
      acceptsReferrals: 'accepts-referrals',
      attorneyToAttorneyOnly: 'atty-to-atty',
      clearEnabled: 'clear-enabled',
    };
    return map[camel] || camel.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  // ─── URL Hash Handling ────────────────────────────────────────────────────

  function handleHashOnLoad() {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    const profile = allProfiles.find(p => p.slug === hash);
    if (profile) openModal(profile);
  }

  // ─── Event Wiring ─────────────────────────────────────────────────────────

  function wireEvents() {
    const si = els.searchInput();
    si.addEventListener('input', () => {
      els.searchClear().hidden = si.value === '';
      triggerSearch();
    });
    si.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        si.value = '';
        els.searchClear().hidden = true;
        applyFiltersAndRender();
      }
    });

    els.searchClear().addEventListener('click', () => {
      si.value = '';
      els.searchClear().hidden = true;
      si.focus();
      applyFiltersAndRender();
    });

    ['filter-state', 'filter-county', 'filter-practice', 'filter-language', 'filter-credential'].forEach(id => {
      document.getElementById(id).addEventListener('change', applyFiltersAndRender);
    });

    ['filter-accepts-referrals', 'filter-atty-to-atty', 'filter-clear-enabled'].forEach(id => {
      document.getElementById(id).addEventListener('change', applyFiltersAndRender);
    });

    els.clearFiltersBtn().addEventListener('click', resetAllFilters);
    els.emptyReset().addEventListener('click', resetAllFilters);

    // Modal events
    els.modalCloseBtn().addEventListener('click', closeModal);
    els.modalCloseFooter().addEventListener('click', closeModal);
    els.modal().addEventListener('click', e => {
      if (e.target === els.modal()) closeModal(); // click outside panel
    });
    document.addEventListener('keydown', e => {
      if (!els.modal().hidden) handleModalKeydown(e);
    });

    // Browser back closes modal
    window.addEventListener('popstate', e => {
      if (!els.modal().hidden) {
        els.modal().hidden = true;
        document.body.classList.remove('modal-open');
        openModalProfile = null;
      }
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    wireEvents();
    loadProfiles().then(() => {
      handleHashOnLoad();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
