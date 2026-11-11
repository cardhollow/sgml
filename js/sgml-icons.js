/*
 * SGML inline icon registry.
 * Syntax: <icowarning/> or <icowarning scale:[1.5] color:"#d97706" border:"2px #f59e0b"/>
 * A single scale is a uniform multiplier (or an explicit px size); two values
 * are explicit width and height in pixels. Style parameters are declared per icon.
 */
(function (global) {
  "use strict";

  const bodies = {
    success: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 8.5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16.5 8.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/>',
    warning: '<path d="M10.3 4.6 2.9 17.4A1.8 1.8 0 0 0 4.5 20h15a1.8 1.8 0 0 0 1.6-2.6L13.7 4.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
    alert: '<path d="M10.3 4.6 2.9 17.4A1.8 1.8 0 0 0 4.5 20h15a1.8 1.8 0 0 0 1.6-2.6L13.7 4.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5M12 17h.01"/>',
    "alert-circle": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5m0 4h.01"/>',
    "alert-triangle": '<path d="M10.3 4.6 2.9 17.4A1.8 1.8 0 0 0 4.5 20h15a1.8 1.8 0 0 0 1.6-2.6L13.7 4.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5M12 17h.01"/>',
    idea: '<path d="M9 18h6m-5 3h4m-2-19a7 7 0 0 0-4 12.7c.8.6 1.3 1.3 1.5 2.3h5c.2-1 .7-1.7 1.5-2.3A7 7 0 0 0 12 2Z"/>',
    lightbulb: '<path d="M9 18h6m-5 3h4m-2-19a7 7 0 0 0-4 12.7c.8.6 1.3 1.3 1.5 2.3h5c.2-1 .7-1.7 1.5-2.3A7 7 0 0 0 12 2Z"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8m-8 4h8"/>',
    "book-open": '<path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H12v17H5.5A2.5 2.5 0 0 0 3 22zM21 5.5A2.5 2.5 0 0 0 18.5 3H12v17h6.5a2.5 2.5 0 0 1 2.5 2z"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
    note: '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h7"/>',
    file: '<path d="M6 3h8l5 5v13H6zM14 3v5h5M9 13h7m-7 4h7"/>',
    "file-text": '<path d="M6 3h8l5 5v13H6zM14 3v5h5M9 12h7m-7 4h7m-7 3h5"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    "folder-open": '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1M3 8h18l-2 10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4 1.4-1.1a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1L13 7h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.2 2.4Z" transform="translate(-1 -1)"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a8 8 0 0 0 0-6l1.5-1.2-1.8-3.1-1.8.7a8 8 0 0 0-5.2-1.5L11.5 2h-3l-.6 1.9a8 8 0 0 0-2.6 1.5l-1.8-.7-1.8 3.1L3.2 9a8 8 0 0 0 0 6l-1.5 1.2 1.8 3.1 1.8-.7a8 8 0 0 0 2.6 1.5l.6 1.9h3l.6-1.9a8 8 0 0 0 2.6-1.5l1.8.7 1.8-3.1z" transform="translate(1 -1) scale(.92)"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    "arrow-up": '<path d="M12 19V5m-7 7 7-7 7 7"/>',
    "arrow-down": '<path d="M12 5v14m7-7-7 7-7-7"/>',
    "arrow-left": '<path d="M19 12H5m7-7-7 7 7 7"/>',
    "arrow-right": '<path d="M5 12h14m-7-7 7 7-7 7"/>',
    "chevron-up": '<path d="m6 15 6-6 6 6"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "chevron-left": '<path d="m15 18-6-6 6-6"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    heart: '<path d="M20.8 8.8c0 5.1-8.8 11-8.8 11S3.2 13.9 3.2 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h2m4 0h2m-8 3h2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-7a4 4 0 0 1 0 8m3 3a4 4 0 0 1 2 4v2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    phone: '<path d="M7 3h3l2 5-2 2a15 15 0 0 0 4 4l2-2 5 2v3a2 2 0 0 1-2 2C10 18 6 14 5 7a2 2 0 0 1 2-4Z"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 2 2m-5 1 2 2"/>',
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/>',
    "shield-check": '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m8.5 12 2.3 2.3 4.8-5"/>',
    "shield-alert": '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="M12 8v5m0 3h.01"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>',
    save: '<path d="M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',
    trash: '<path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 10h8m-8 4h8m-8 4h5"/>',
    edit: '<path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4zM14.5 6l3.5 3.5"/>',
    pencil: '<path d="m4 16.5-.8 4.3 4.3-.8L20 7.5 16.5 4zM14.5 6l3.5 3.5"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    camera: '<path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    play: '<path d="m7 4 14 8-14 8z"/>',
    pause: '<path d="M8 5h3v14H8zm6 0h3v14h-3z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    wifi: '<path d="M3 9a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 3a4 4 0 0 1 6 0m-3 4h.01"/>',
    battery: '<rect x="3" y="7" width="17" height="10" rx="2"/><path d="M20 10h2v4h-2M6 10h8v4H6z"/>',
    cloud: '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 20 10a4 4 0 0 1-1 8Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>',
    sparkles: '<path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/>',
    pin: '<path d="m16 3 5 5-5 1-4 4-1 5-5-5 5-1 4-4zM6 18l-3 3"/>',
    "map-pin": '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    cart: '<path d="M3 4h2l2.5 12h11L21 8H6M9 20h.01M18 20h.01"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    gift: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M2 6h20v3H2zM12 6v15m0-15H8a2.5 2.5 0 1 1 2.5-2.5C12 1 12 6 12 6Zm0 0h4a2.5 2.5 0 1 0-2.5-2.5C12 1 12 6 12 6Z"/>',
    tag: '<path d="M20 13 13 20 3 10V4h6z"/><circle cx="7.5" cy="7.5" r="1"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    "eye-off": '<path d="m3 3 18 18M10.6 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3.2 4.1M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a9 9 0 0 0 3-.5"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 3 4 3 4-3 4-3M9 9h.01M15 9h.01"/>',
    "thumbs-up": '<path d="M7 10v11H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zm0 0 5-7a3 3 0 0 1 2 3l-1 4h6a2 2 0 0 1 2 2l-2 7a2 2 0 0 1-2 2H7"/>',
    "thumbs-down": '<path d="M7 14V3H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2zm0 0 5 7a3 3 0 0 0 2-3l-1-4h6a2 2 0 0 0 2-2l-2-7a2 2 0 0 0-2-2H7"/>',
    trophy: '<path d="M8 21h8m-4-4v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4"/>',
    medal: '<circle cx="12" cy="8" r="5"/><path d="m8 12-2 9 6-3 6 3-2-9"/>',
    fire: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-2-1-3-3-3-5-3 3-5 6-5 10a8 8 0 0 0 8 6Z"/><path d="M12 22a4 4 0 0 0 4-4c0-2-1-3-2-4-.5 1.5-1.5 2-2 2.5-.5-1.5-1-2-2-3-1 1.5-2 3-2 4.5a4 4 0 0 0 4 4Z"/>',
    rocket: '<path d="M4 16c-1 1-1 4-1 4s3 0 4-1l3-3-3-3zM14 5c3-3 7-3 7-3s0 4-3 7l-7 7-4-4z"/><path d="M14 5c0 2 1 4 3 4M5 19l-2 2m5-7-2 2"/>',
    chart: '<path d="M4 20V4m0 16h17M8 16l4-5 3 2 5-7"/>',
    "chart-bar": '<path d="M4 20V4m0 16h17M8 16v-5m5 5V7m5 9V3"/>',
    "pie-chart": '<path d="M11 3a9 9 0 1 0 10 10H11zM14 3v7h7a9 9 0 0 0-7-7Z"/>',
    calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8v4H8zm0 8h2m4 0h2m-8 4h2m4 0h2"/>',
    wallet: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18m-5 5h2"/><path d="M17 11h4v5h-4a2 2 0 0 1 0-5Z"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-1-1.7-1.5-3-1.5-1.7 0-3 1-3 2.5s1.3 2.2 3 2.5 3 1 3 2.5-1.3 2.5-3 2.5c-1.3 0-2.3-.5-3-1.5M12 5v14"/>',
    "credit-card": '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20m-15 5h4"/>',
    receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8m-8 4h8m-8 4h5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12h18m-11 0v2h4v-2"/>',
    school: '<path d="m2 9 10-6 10 6-10 6zM6 12v5c4 3 8 3 12 0v-5M22 9v7"/>',
    graduation: '<path d="m2 9 10-6 10 6-10 6zM6 12v5c4 3 8 3 12 0v-5M22 9v7"/>',
    leaf: '<path d="M20 4c-8 0-14 3-14 10a6 6 0 0 0 6 6c7 0 10-8 8-16Z"/><path d="M4 21c3-6 7-9 13-12"/>',
    bug: '<path d="M8 8h8a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4ZM12 8V4m-4 0 8 0M4 12H2m20 0h-2M4 18H2m20 0h-2M7 4 5 2m12 2 2-2M9 13h.01M15 13h.01"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    server: '<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6m-6 10h6"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4M10 10h4v4h-4z"/>',
    smartphone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4m-3 14h2"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    laptop: '<rect x="4" y="3" width="16" height="13" rx="2"/><path d="M2 20h20l-2-4H4z"/>',
    printer: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/><path d="M18 12h.01"/>',
    paperclip: '<path d="m8 12 7-7a4 4 0 0 1 6 6l-9 9a6 6 0 0 1-8-8l9-9"/>',
    attachment: '<path d="m8 12 7-7a4 4 0 0 1 6 6l-9 9a6 6 0 0 1-8-8l9-9"/>',
    music: '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="18" cy="16" rx="3" ry="2"/>',
    volume: '<path d="M4 10v4h4l5 4V6l-5 4zM17 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/>',
    "volume-off": '<path d="M4 10v4h4l5 4V6l-5 4zM17 10l5 5m0-5-5 5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>',
    inbox: '<path d="M4 4h16l2 12h-6l-2 3h-4l-2-3H2zM2 16h6m8 0h6"/>',
    archive: '<path d="M3 4h18v4H3zM5 8v13h14V8m-7 3v6m-3-3 3 3 3-3"/>',
    question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.4 1.9c-1.2 1-1.9 1.3-1.9 3.1m0 3h.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.4 1.9c-1.2 1-1.9 1.3-1.9 3.1m0 3h.01"/>',
    external: '<path d="M14 3h7v7m0-7-9 9"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/>',
    "external-link": '<path d="M14 3h7v7m0-7-9 9"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7m2.7 6.4a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/>',
    "check-list": '<path d="m4 6 2 2 3-3m3 2h8M4 14l2 2 3-3m3 2h8M4 20h5"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    "list-ordered": '<path d="M10 6h11M10 12h11M10 18h11M4 5h2v4m-2 0h3m-3 4h2a1 1 0 0 1 0 2H4l3 3H4"/>',
    "list-check": '<path d="m3 6 2 2 3-3m3 2h10M3 14l2 2 3-3m3 2h10"/>',
    hourglass: '<path d="M5 3h14M5 21h14M6 3c0 5 6 6 6 9s-6 4-6 9m12-18c0 5-6 6-6 9s6 4 6 9"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5z"/>',
    flag: '<path d="M5 21V4m0 1c5-4 9 4 14 0v11c-5 4-9-4-14 0"/>',
    map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
    coffee: '<path d="M4 8h14v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM18 10h2a2 2 0 1 1 0 4h-2M7 3v2m5-2v2m5-2v2"/>',
    clockwise: '<path d="M20 7v5h-5M4 17v-5h5M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3"/>',
    "more-horizontal": '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    "more-vertical": '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    pause: '<path d="M8 5h3v14H8zm6 0h3v14h-3z"/>'
  };

  const colorDefaults = {
    success: "#16a34a", check: "#16a34a", "check-circle": "#16a34a",
    info: "#2563eb", warning: "#d97706", alert: "#d97706", "alert-circle": "#d97706", "alert-triangle": "#d97706",
    error: "#dc2626", idea: "#ca8a04", lightbulb: "#ca8a04", heart: "#e11d48", star: "#ca8a04", shield: "#2563eb"
  };

  function safeColor(value, fallback) {
    const color = String(value == null ? "" : value).trim();
    if (!color) return fallback;
    if (/^(?:none|transparent|currentcolor)$/i.test(color)) return color;
    if (typeof CSS !== "undefined" && CSS.supports && CSS.supports("color", color)) return color;
    if (/^(#[\da-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\([\d\s.,%+-]+\))$/i.test(color)) return color;
    return fallback;
  }

  function parseScale(value) {
    if (value == null || value === "") return { width: 24, height: 24 };
    const raw = Array.isArray(value) ? value : String(value).replace(/^\[|\]$/g, "").split(",");
    const numbers = raw.map(item => {
      const text = String(item).trim().toLowerCase();
      const parsed = Number.parseFloat(text);
      return Number.isFinite(parsed) ? { value: parsed, px: text.endsWith("px") } : null;
    });
    if (!numbers.length || numbers.some(item => !item || item.value <= 0)) return { width: 24, height: 24 };
    const toSize = item => item.px || item.value > 4 ? item.value : item.value * 24;
    if (numbers.length > 1) return { width: clampSize(toSize(numbers[0])), height: clampSize(toSize(numbers[1])) };
    const size = clampSize(toSize(numbers[0]));
    return { width: size, height: size };
  }

  function clampSize(value) { return Math.max(8, Math.min(512, Number(value) || 24)); }

  function parseBorder(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw || /^(?:none|false|0)$/i.test(raw)) return null;
    const parts = raw.split(/[\s,]+/).filter(Boolean);
    let width = 1.5;
    let color = "#94a3b8";
    for (const part of parts) {
      const size = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(part);
      if (size) width = Math.max(0.5, Math.min(8, Number(size[1])));
      else color = safeColor(part, color);
    }
    return { width, color };
  }

  function makeIcon(name, body) {
    const defaultColor = colorDefaults[name] || "#334155";
    const entry = {
      style: [
        { paramName: "color", value: defaultColor, description: "Icon stroke color" },
        { paramName: "fill", value: "none", description: "Optional interior fill" },
        { paramName: "strokeWidth", value: "2", description: "Line thickness" },
        { paramName: "border", value: "none", description: "Optional border: size and color in either order" },
        { paramName: "opacity", value: "1", description: "Icon opacity from 0 to 1" },
        { paramName: "rotate", value: "0", description: "Rotation in degrees" }
      ],
      focus: "color",
      svg(ctx) {
        const style = ctx && ctx.style || {};
        const scale = ctx && ctx.scale || { width: 24, height: 24 };
        const color = safeColor(style.color, defaultColor);
        const strokeWidth = Math.max(0.5, Math.min(8, Number.parseFloat(style.strokeWidth) || 2));
        const opacityValue = Number.parseFloat(style.opacity);
        const opacity = Number.isFinite(opacityValue) ? Math.max(0, Math.min(1, opacityValue)) : 1;
        const rotateValue = Number.parseFloat(style.rotate);
        const rotate = Number.isFinite(rotateValue) ? rotateValue % 360 : 0;
        const border = parseBorder(style.border);
        const borderMarkup = border
          ? `<rect x="1" y="1" width="22" height="22" rx="4" fill="none" stroke="${border.color}" stroke-width="${border.width}"/>`
          : "";
        const fill = safeColor(style.fill, "none");
        const transform = rotate ? ` transform="rotate(${rotate} 12 12)"` : "";
        return `<svg class="sgml-inline-icon" xmlns="http://www.w3.org/2000/svg" width="${scale.width}" height="${scale.height}" viewBox="0 0 24 24" role="img" aria-label="${name.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" focusable="false" style="display:inline-block;vertical-align:-0.2em;flex:none;color:${color};opacity:${opacity}"${transform}>${borderMarkup}<g fill="${fill}" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
      }
    };
    return entry;
  }

  function parseAttributes(raw) {
    const result = {};
    const pattern = /([a-z][a-z0-9_-]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|\[([^\]]*)\]|([^\s/>]+))/gi;
    let match;
    while ((match = pattern.exec(String(raw || "")))) {
      result[match[1]] = match[2] ?? match[3] ?? (match[4] !== undefined ? match[4].split(",").map(value => value.trim()) : match[5]) ?? "";
    }
    return result;
  }

  const registry = {};
  Object.keys(bodies).forEach(name => { registry[name] = makeIcon(name, bodies[name]); });
  // Common names that should read naturally in SGML documents.
  registry.ok = registry.success;
  registry.warning = registry.warning;
  registry.danger = registry.error;
  registry.alert = registry.alert;
  registry.help = registry.help;
  registry.question = registry.question;
  registry.bookmark = registry.bookmark;
  registry["checkmark"] = registry.check;

  global.SGMLICON = registry;
  global.renderSGMLIcon = function renderSGMLIcon(name, rawAttributes) {
    const iconName = String(name || "").replace(/^ico/i, "").toLowerCase();
    const icon = registry[iconName];
    if (!icon) return "";
    const attributes = parseAttributes(rawAttributes);
    const style = {};
    for (const definition of icon.style || []) {
      const key = definition.paramName;
      style[key] = definition.value;
    }
    Object.keys(attributes).forEach(key => {
      if (key === "scale") return;
      style[key] = attributes[key];
    });
    const scale = parseScale(attributes.scale);
    return icon.svg({ scale, style, name: iconName });
  };
  global.getSGMLIconNames = () => Object.keys(registry);
  global.getSGMLIconSuggestion = name => {
    const icon = registry[String(name || "").replace(/^ico/i, "").toLowerCase()];
    if (!icon) return null;
    return {
      insert: `<ico${String(name || "").replace(/^ico/i, "").toLowerCase()}${icon.focus ? ` ${icon.focus}:"$0"` : ""}/>`
    };
  };
})(window);
