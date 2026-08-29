export const embeddedThemeStyles=`
:root:is([data-theme-id="glass"],[data-theme-id="glass-light"]) body {
  backdrop-filter:blur(var(--glass-blur,22px)) saturate(var(--glass-saturation,1.5));
  -webkit-backdrop-filter:blur(var(--glass-blur,22px)) saturate(var(--glass-saturation,1.5));
}
:root:is([data-theme-id="glass"],[data-theme-id="glass-light"]) :is(button,input,textarea,select) {
  border-color:var(--line)!important;
  box-shadow:inset 0 1px rgba(255,255,255,.16);
}
:root:is([data-theme-id="glass"],[data-theme-id="glass-light"]) button:hover {
  background-color:color-mix(in srgb,var(--accent) 18%,var(--surface-2))!important;
  box-shadow:0 7px 18px color-mix(in srgb,var(--text) 13%,transparent),inset 0 1px rgba(255,255,255,.28);
}
:root[data-theme-id="glass"] body {
  background:linear-gradient(145deg,rgba(5,13,34,.84),rgba(22,28,70,.72));
}
:root[data-theme-id="glass-light"] body {
  background:linear-gradient(145deg,rgba(255,255,255,.54),rgba(225,239,253,.38));
}
:root[data-theme-id="glass-light"] :is(button,input,textarea,select) {
  background-color:rgba(255,255,255,.4);
}
`;
