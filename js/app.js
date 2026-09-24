// PoEdle shell: a registry of minigames + hash routing (#poe1-uniques, ...).
// A minigame registers itself with PoEdle.register({ id, name, mount(container) }).
window.PoEdle = (function () {
  const games = [];
  const scripts = new Map();

  // Tiny DOM helper: h('div', { class: 'x', onclick: fn }, child, 'text', ...)
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(c));
    }
    return el;
  }

  // Load a classic script once (works from file:// too, unlike fetch or ES modules).
  function loadScript(src) {
    if (!scripts.has(src)) {
      scripts.set(src, new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { scripts.delete(src); reject(new Error('Could not load ' + src)); };
        document.head.append(s);
      }));
    }
    return scripts.get(src);
  }

  function register(game) {
    games.push(game);
  }

  function route() {
    const id = location.hash.slice(1);
    const game = games.find(g => g.id === id) || games[0];
    const nav = document.getElementById('game-nav');
    nav.replaceChildren(...games.map(g =>
      h('a', { href: '#' + g.id, class: g === game ? 'active' : null }, g.name)));
    // A fresh view per route: an async mount can check view.isConnected to know it was left.
    const view = h('div');
    document.getElementById('app').replaceChildren(view);
    game.mount(view);
  }

  function start() {
    window.addEventListener('hashchange', route);
    route();
  }

  return { h, loadScript, register, start };
})();
