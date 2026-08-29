const theme=(id,nameEn,nameZh,baseMode,colors,background,preview,options={})=>({manifest:{formatVersion:1,id,version:'1.0.0',name:{en:nameEn,zh:nameZh},description:options.description||{en:`Future ${nameEn} system theme.`,zh:`伏秋 ${nameZh}系统主题。`},author:'Future',baseMode},tokens:{colors,typography:{uiFont:'Manrope, "SF Pro Display", "Segoe UI", sans-serif',monoFont:'"Ubuntu Mono", ui-monospace, monospace',scale:1},shape:options.shape||{small:7,medium:12,large:18,window:18},icons:{shape:'squircle',scale:1,...options.icons},material:options.material||{blur:26,saturation:1.25,transparency:.92,shadowStrength:1},motion:{scale:1}},wallpaper:{background,preview}});

export const builtinThemes=[
  theme('light','Future Light','伏秋浅色','light',{accent:'#5f87d7',surface:'#e5edf2',surfaceElevated:'#eef4f7',text:'#31445a',muted:'#77899b',border:'#607a8a24',positive:'#4c9a72',warning:'#cf8a45',danger:'#c65d6d'},'radial-gradient(circle at 20% 18%,#f6c7d9 0,transparent 34%),radial-gradient(circle at 82% 20%,#bfe3f2 0,transparent 38%),linear-gradient(145deg,#dce9f1,#cbdbe7 55%,#e5d9eb)','#dce9f1'),
  theme('dark','Future Dark','伏秋深色','dark',{accent:'#7899e8',surface:'#334957',surfaceElevated:'#3c515e',text:'#dbe6ea',muted:'#91a4af',border:'#ffffff17',positive:'#66b88b',warning:'#dda15f',danger:'#dc7583'},'radial-gradient(circle at 18% 15%,#7d315e 0,transparent 35%),radial-gradient(circle at 82% 18%,#245d86 0,transparent 40%),radial-gradient(circle at 60% 90%,#483985 0,transparent 46%),linear-gradient(140deg,#352743,#183c58 55%,#252954)','#263f55'),
  theme('glass-light','Future Glass Light','伏秋玻璃浅色','light',{accent:'#3979df',surface:'#eff7ffcc',surfaceElevated:'#ffffffe3',text:'#1d3047',muted:'#5d728a',border:'#55708f2e',positive:'#238b73',warning:'#a9681f',danger:'#c3476d'},'radial-gradient(circle at 12% 14%,#85c8ff 0,transparent 33%),radial-gradient(circle at 86% 17%,#cfb2ff 0,transparent 35%),radial-gradient(circle at 76% 86%,#ffb2d4 0,transparent 38%),radial-gradient(circle at 18% 88%,#9ce9db 0,transparent 36%),linear-gradient(145deg,#e7f4ff,#eeeaff 51%,#ffeaf5)','#dcecff',{
    description:{en:'A bright frosted-glass system with airy layers, soft spectral light and crisp readable controls.',zh:'具有轻盈层次、柔和彩色光晕与清晰交互的浅色玻璃拟态系统主题。'},
    shape:{small:9,medium:14,large:22,window:24},
    icons:{shape:'squircle',scale:1.02,mode:'outline',strokeWidth:1.8,linecap:'round',linejoin:'round'},
    material:{blur:22,saturation:1.4,transparency:.76,shadowStrength:.9},
  }),
  theme('glass','Future Glass Dark','伏秋玻璃深色','dark',{accent:'#65b8ff',surface:'#152343c7',surfaceElevated:'#30466bd9',text:'#f5f8ff',muted:'#b8c5df',border:'#ffffff38',positive:'#49d5c2',warning:'#f5c46a',danger:'#ff6f9c'},'radial-gradient(circle at 13% 14%,#0080ff 0,transparent 31%),radial-gradient(circle at 86% 17%,#8b00ff 0,transparent 34%),radial-gradient(circle at 74% 85%,#ff1493 0,transparent 37%),radial-gradient(circle at 18% 88%,#20b2aa 0,transparent 35%),linear-gradient(145deg,#071226,#101b43 52%,#251148)','#263c75',{
    description:{en:'A dark layered frosted-glass system with luminous depth, vibrant light and responsive translucent controls.',zh:'具有发光层次、鲜明色彩与通透交互的深色玻璃拟态系统主题。'},
    shape:{small:9,medium:14,large:22,window:24},
    icons:{shape:'squircle',scale:1.02,mode:'outline',strokeWidth:1.8,linecap:'round',linejoin:'round'},
    material:{blur:22,saturation:1.55,transparency:.74,shadowStrength:1.15},
  }),
];
