// Unique Guesser: guess a random unique; each guess is compared column by column.
// Registered once per game (PoE 1, PoE 2); each loads its own data file on first visit.
(function () {
  const { h } = PoEdle;
  const MAX_SUGGESTIONS = 50;

  // Search key: lowercase, no accents or punctuation ("Maligaro's" -> "maligaros").
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, '');

  // Mod key ignores roll values so "(20-28)% increased Spell Damage" and
  // "15% increased Spell Damage" count as the same affix.
  const RANGE = /[+-]?\(\s*[+-]?\d+(?:\.\d+)?\s*-\s*[+-]?\d+(?:\.\d+)?\s*\)/g;
  const NUMBER = /[+-]?\d+(?:\.\d+)?/g;
  const modKey = m => m.toLowerCase().replace(RANGE, '#').replace(NUMBER, '#').replace(/\s+/g, ' ').trim();

  function prepare(items) {
    for (const it of items) {
      it._search = norm(it.name);
      it._searchBase = norm(it.base + ' ' + it.type);
      it._implicitKeys = it.implicits.map(modKey);
      it._explicitKeys = it.explicits.map(modKey);
    }
    return { items, byName: new Map(items.map(it => [it.name, it])) };
  }

  const displayMod = m => m.replace(/(\d)-(\d)/g, '$1–$2');

  // ---- comparison --------------------------------------------------------

  function compareValue(a, b) {
    return a === b ? 'match' : 'miss';
  }

  function compareMods(guessKeys, solutionKeys) {
    const g = new Set(guessKeys);
    const s = new Set(solutionKeys);
    const shared = new Set([...g].filter(k => s.has(k)));
    let status = 'miss';
    if (shared.size === g.size && shared.size === s.size) status = 'match';
    else if (shared.size > 0) status = 'partial';
    return { status, shared };
  }

  function compare(guess, solution) {
    return {
      item: guess === solution ? 'match' : 'none',
      category: compareValue(guess.category, solution.category),
      type: compareValue(guess.type, solution.type),
      implicits: compareMods(guess._implicitKeys, solution._implicitKeys),
      explicits: compareMods(guess._explicitKeys, solution._explicitKeys),
    };
  }

  // ---- state ---------------------------------------------------------------

  function newState({ items }) {
    return { solution: items[Math.floor(Math.random() * items.length)].name, guesses: [], over: false, gaveUp: false };
  }

  function loadState(data, storageKey) {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey));
      if (s && data.byName.has(s.solution) && s.guesses.every(g => data.byName.has(g))) return s;
    } catch (e) { /* storage unavailable or corrupt: start fresh */ }
    return newState(data);
  }

  function saveState(storageKey, state) {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---- rendering helpers ---------------------------------------------------

  const img = (it, cls) => h('img', { src: it.image, alt: '', class: cls, loading: 'lazy' });

  function requirementsText(req) {
    const parts = [];
    if (req.level) parts.push('Level ' + req.level);
    if (req.str) parts.push(req.str + ' Str');
    if (req.dex) parts.push(req.dex + ' Dex');
    if (req.int) parts.push(req.int + ' Int');
    return parts.length ? 'Requires ' + parts.join(', ') : null;
  }

  // PoE-style item tooltip for the revealed solution.
  function tooltip(it) {
    const req = requirementsText(it.requirements);
    const sections = [];
    if (req) sections.push(h('div', { class: 'tt-req' }, req));
    if (it.implicits.length) sections.push(it.implicits.map(m => h('div', { class: 'tt-mod' }, displayMod(m))));
    if (it.explicits.length) sections.push(it.explicits.map(m => h('div', { class: 'tt-mod' }, displayMod(m))));
    if (it.reminders.length) sections.push(it.reminders.map(r => h('div', { class: 'tt-reminder' }, r)));
    if (it.corrupted) sections.push(h('div', { class: 'tt-corrupted' }, 'Corrupted'));

    const body = h('div', { class: 'tt-body' });
    sections.forEach((s, i) => {
      if (i) body.append(h('div', { class: 'tt-sep' }));
      body.append(...[].concat(s));
    });
    return h('div', { class: 'solution-card' },
      h('div', { class: 'solution-art' }, img(it)),
      h('div', { class: 'tooltip' },
        h('div', { class: 'tt-head' },
          h('div', { class: 'tt-name' }, it.name),
          h('div', { class: 'tt-base' }, it.base)),
        body,
        h('a', { class: 'tt-link', href: it.url, target: '_blank', rel: 'noopener' }, 'View on poedb ↗')));
  }

  function modCell(mods, keys, result, i) {
    const list = mods.length
      ? h('ul', { class: 'mods' }, mods.map((m, j) =>
          h('li', { class: result.shared.has(keys[j]) ? 'shared' : null }, displayMod(m))))
      : h('span', { class: 'empty' }, 'None');
    return h('div', { class: `cell mods-cell ${result.status}`, style: `--i:${i}` }, list);
  }

  function guessRow(guess, solution, fresh) {
    const r = compare(guess, solution);
    return h('div', { class: 'grid-row' + (fresh ? ' fresh' : '') },
      h('div', { class: `cell item-cell ${r.item}`, style: '--i:0' },
        img(guess, 'item-img'),
        h('div', null,
          h('div', { class: 'item-name' }, guess.name),
          h('div', { class: 'item-base' }, guess.base))),
      h('div', { class: `cell ${r.category}`, style: '--i:1' }, guess.category),
      h('div', { class: `cell ${r.type}`, style: '--i:2' }, guess.type),
      modCell(guess.implicits, guess._implicitKeys, r.implicits, 3),
      modCell(guess.explicits, guess._explicitKeys, r.explicits, 4));
  }

  // Help dialog: which item types belong to each category, built from the data.
  function helpDialog(items) {
    const categories = ['Weapon', 'Armour', 'Other'];
    const types = new Map(categories.map(c => [c, new Map()]));
    for (const it of items) {
      const t = types.get(it.category);
      t.set(it.type, (t.get(it.type) || 0) + 1);
    }

    const dialog = h('dialog', { class: 'help-dialog', 'aria-labelledby': 'ug-help-title' });
    const close = () => dialog.close();
    dialog.append(h('div', { class: 'help-inner' },
      h('div', { class: 'help-head' },
        h('h3', { id: 'ug-help-title' }, 'Item types by category'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, '×')),
      h('p', { class: 'help-text' },
        'Every unique belongs to one category and one item type. ',
        'Both columns are green only on an exact match. The number is how many uniques of that type are in the game.'),
      h('div', { class: 'help-cols' }, categories.map(c => {
        const entries = [...types.get(c)].sort((a, b) => a[0].localeCompare(b[0]));
        const total = entries.reduce((n, [, k]) => n + k, 0);
        return h('section', null,
          h('h4', null, c, h('span', { class: 'count' }, total)),
          h('ul', null, entries.map(([t, n]) => h('li', null, t, h('span', { class: 'count' }, n)))));
      }))));
    // A click on the backdrop lands on the <dialog> itself, outside .help-inner.
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    return dialog;
  }

  // ---- game ------------------------------------------------------------------

  function play(root, game, data) {
    const { items, byName } = data;
    const storageKey = `poedle.${game.id}.v1`;
    let state = loadState(data, storageKey);
    let suggestions = [];
    let active = 0;
    let freshGuess = null;

    const input = h('input', {
      type: 'search', class: 'search-input', placeholder: 'Type a unique item name…',
      autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search unique items',
      role: 'combobox', 'aria-controls': 'ug-suggestions', 'aria-expanded': 'false',
    });
    const list = h('ul', { id: 'ug-suggestions', class: 'suggestions', role: 'listbox', hidden: true });
    const counter = h('span', { class: 'counter' });
    const giveUpBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: giveUp }, 'Give up');
    const newBtn = h('button', { class: 'btn', type: 'button', onclick: newGame }, 'New unique');
    const help = helpDialog(items);
    const helpBtn = h('button', {
      class: 'btn btn-ghost', type: 'button', 'aria-haspopup': 'dialog',
      onclick: () => help.showModal(),
    }, 'Help');
    const result = h('section', { class: 'result', hidden: true });
    const rows = h('div', { class: 'grid-body' });

    root.append(
      h('section', { class: 'intro' },
        h('h2', null, game.name),
        h('p', null, 'A random unique item has been chosen. Guess any unique and compare its properties.'),
        h('ul', { class: 'legend' },
          h('li', null, h('span', { class: 'swatch match' }), 'Exact match'),
          h('li', null, h('span', { class: 'swatch partial' }), 'Some affixes shared'),
          h('li', null, h('span', { class: 'swatch miss' }), 'No match')),
        h('p', { class: 'hint' }, 'Affixes are compared ignoring their values. Shared lines are highlighted.')),
      h('div', { class: 'controls' },
        h('div', { class: 'search' }, input, list),
        counter, helpBtn, giveUpBtn, newBtn),
      help,
      result,
      h('div', { class: 'grid-scroll' },
        h('div', { class: 'grid' },
          h('div', { class: 'grid-row grid-head' },
            ['Item', 'Category', 'Item type', 'Implicit affixes', 'Explicit affixes']
              .map(t => h('div', { class: 'cell' }, t))),
          rows)));

    function render() {
      const solution = byName.get(state.solution);
      const n = state.guesses.length;
      counter.textContent = n ? `${n} guess${n > 1 ? 'es' : ''}` : '';
      input.disabled = state.over;
      giveUpBtn.hidden = state.over;
      input.placeholder = state.over ? 'Start a new game to play again' : 'Type a unique item name…';

      rows.replaceChildren(...state.guesses.slice().reverse()
        .map(name => guessRow(byName.get(name), solution, name === freshGuess)));
      freshGuess = null;

      result.hidden = !state.over;
      if (state.over) {
        result.replaceChildren(
          h('h3', { class: state.gaveUp ? 'lost' : 'won' },
            state.gaveUp ? 'The unique was…'
              : `Found in ${n} guess${n > 1 ? 'es' : ''}!`),
          tooltip(solution),
          h('button', { class: 'btn', type: 'button', onclick: newGame }, 'Play again'));
      }
    }

    function search(q) {
      const n = norm(q).trim();
      if (!n) return [];
      const guessed = new Set(state.guesses);
      const hits = [];
      for (const it of items) {
        if (guessed.has(it.name)) continue;
        const pos = it._search.indexOf(n);
        let rank;
        if (pos === 0) rank = 0;
        else if (pos > 0) rank = it._search.includes(' ' + n) ? 1 : 2;
        else if (it._searchBase.includes(n)) rank = 3;
        else continue;
        hits.push([rank, it]);
      }
      hits.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
      return hits.slice(0, MAX_SUGGESTIONS).map(x => x[1]);
    }

    function showSuggestions() {
      suggestions = search(input.value);
      active = 0;
      list.replaceChildren(...suggestions.map((it, i) =>
        h('li', {
          role: 'option', id: 'ug-opt-' + i, class: i === active ? 'active' : null,
          onmousedown: e => { e.preventDefault(); guess(it); },
          onmousemove: () => setActive(i),
        },
          img(it, 'sugg-img'),
          h('span', { class: 'sugg-name' }, it.name),
          h('span', { class: 'sugg-base' }, it.base))));
      if (!suggestions.length && input.value.trim()) {
        list.replaceChildren(h('li', { class: 'no-results' }, 'No unique found'));
      }
      const open = !!input.value.trim();
      list.hidden = !open;
      input.setAttribute('aria-expanded', String(open));
      input.setAttribute('aria-activedescendant', suggestions.length ? 'ug-opt-0' : '');
    }

    function setActive(i) {
      if (!suggestions.length) return;
      active = (i + suggestions.length) % suggestions.length;
      [...list.children].forEach((li, j) => li.classList.toggle('active', j === active));
      list.children[active].scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', 'ug-opt-' + active);
    }

    function closeSuggestions() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }

    function guess(it) {
      if (state.over || state.guesses.includes(it.name)) return;
      state.guesses.push(it.name);
      if (it.name === state.solution) state.over = true;
      freshGuess = it.name;
      saveState(storageKey, state);
      input.value = '';
      closeSuggestions();
      render();
      if (!state.over) input.focus();
    }

    function giveUp() {
      if (state.over) return;
      state.over = true;
      state.gaveUp = true;
      saveState(storageKey, state);
      closeSuggestions();
      render();
    }

    function newGame() {
      state = newState(data);
      saveState(storageKey, state);
      input.value = '';
      closeSuggestions();
      render();
      input.focus();
    }

    input.addEventListener('input', showSuggestions);
    input.addEventListener('focus', () => { if (input.value.trim()) showSuggestions(); });
    input.addEventListener('blur', closeSuggestions);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (suggestions[active]) guess(suggestions[active]); }
      else if (e.key === 'Escape') closeSuggestions();
    });

    render();
    input.focus();
  }

  // One registered minigame per game; its data file (from tools/scrape.py) loads on first visit.
  function register(game) {
    let data = null;
    PoEdle.register({
      id: game.id,
      name: game.name,
      async mount(root) {
        if (!data) {
          root.append(h('p', { class: 'loading' }, 'Loading uniques…'));
          try {
            await PoEdle.loadScript(`data/${game.dataKey}/uniques.js`);
          } catch (e) {
            root.replaceChildren(h('p', { class: 'loading' }, e.message));
            return;
          }
          data = prepare(window.POEDLE_DATA[game.dataKey]);
          if (!root.isConnected) return; // the player switched game while loading
          root.replaceChildren();
        }
        play(root, game, data);
      },
    });
  }

  register({ id: 'poe1-uniques', name: 'PoE 1 Uniques', dataKey: 'poe1' });
  register({ id: 'poe2-uniques', name: 'PoE 2 Uniques', dataKey: 'poe2' });
})();
