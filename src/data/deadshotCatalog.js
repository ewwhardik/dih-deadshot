/**
 * Complete reverse-engineered Deadshot.io asset, storage, and schema catalog.
 * Mapped from Deadshot.io's public bundle & static CDN routes.
 */

const WEAPONS = {
  ar: {
    id: "ar",
    name: "Assault Rifle (AR2)",
    shortName: "AR",
    folder: "ar2",
    texture: "weapons/ar2/arcomp.webp",
    mobileTexture: "weapons/ar2/arcompmobile.webp",
    smallTexture: "weapons/ar2/arcompsmall.webp",
    model: "weapons/ar2/ar2.glb",
    mask: "weapons/ar2/ar2mask.png",
  },
  smg: {
    id: "smg",
    name: "Vector (SMG)",
    shortName: "SMG",
    folder: "vector",
    texture: "weapons/vector/vectorcomp.webp",
    mobileTexture: "weapons/vector/vectorcompmobile.webp",
    smallTexture: "weapons/vector/vectorcompsmall.webp",
    model: "weapons/vector/vector.glb",
    mask: "weapons/vector/vectormask.png",
  },
  awp: {
    id: "awp",
    name: "AWP Sniper",
    shortName: "AWP",
    folder: "awp",
    texture: "weapons/awp/newawpcomp.webp",
    legacyTexture: "weapons/awp/awpcomp.webp",
    mobileTexture: "weapons/awp/newawpcompmobile.webp",
    smallTexture: "weapons/awp/newawpcompsmall.webp",
    model: "weapons/awp/awp.glb",
    mask: "weapons/awp/awpmask.png",
  },
  shotgun: {
    id: "shotgun",
    name: "Shotgun",
    shortName: "Shotgun",
    folder: "shotgun",
    texture: "weapons/shotgun/shotguncomp.webp",
    mobileTexture: "weapons/shotgun/shotguncompmobile.webp",
    smallTexture: "weapons/shotgun/shotguncompsmall.webp",
    model: "weapons/shotgun/shotgun.glb",
    mask: null,
  },
  dmr: {
    id: "dmr",
    name: "DMR Marksman",
    shortName: "DMR",
    folder: "dmr",
    texture: "weapons/dmr/dmrcomp.webp",
    mobileTexture: "weapons/dmr/dmrcompmobile.webp",
    smallTexture: "weapons/dmr/dmrcompsmall.webp",
    model: "weapons/dmr/dmr.glb",
    mask: null,
  },
  pistol: {
    id: "pistol",
    name: "Pistol",
    shortName: "Pistol",
    folder: "pistol",
    texture: "weapons/pistol/pistolcomp.webp",
    mobileTexture: "weapons/pistol/pistolcompmobile.webp",
    smallTexture: "weapons/pistol/pistolcompsmall.webp",
    model: "weapons/pistol/pistolanim.glb",
    mask: null,
  },
  lmg: {
    id: "lmg",
    name: "LMG Heavy",
    shortName: "LMG",
    folder: "lmg",
    texture: "weapons/lmg/lmgcomp.webp",
    mobileTexture: "weapons/lmg/lmgcompmobile.webp",
    smallTexture: "weapons/lmg/lmgcompsmall.webp",
    model: "weapons/lmg/lmg.glb",
    mask: null,
  },
};

const MELEE_AND_UTILITY_MODELS = [
  { id: "knife", name: "Default Knife", model: "weapons/knife/knife.glb" },
  { id: "huntsman", name: "Huntsman Knife", model: "weapons/huntsman/knife.glb" },
  { id: "butterfly", name: "Butterfly Knife", model: "weapons/butterfly/butterfly-animated.glb" },
  { id: "c4", name: "C4 Explosive", model: "weapons/c4/c4.glb" },
  { id: "flash", name: "Flashbang", model: "weapons/nades/flash.glb" },
  { id: "molly", name: "Molotov", model: "weapons/nades/molly.glb" },
  { id: "smoke", name: "Smoke Grenade", model: "weapons/nades/smoke.glb" },
];

/**
 * Official Deadshot.io skin catalog:
 * type: 'default' | 'static' (skins/compressed/<id><weapon><wear>.webp) | 'static_nowear' (ice<weapon>.webp) | 'shader'
 */
const OFFICIAL_SKINS = [
  { id: "default", name: "Default Factory", rarity: 0, type: "default" },
  { id: "bacon", name: "Bacon", rarity: 1, type: "static" },
  { id: "tiger", name: "Tigris", rarity: 1, type: "static" },
  { id: "carbon", name: "Carbon Fiber", rarity: 1, type: "static" },
  { id: "linen", name: "Fresh Linen", rarity: 1, type: "static" },
  { id: "greencamo", name: "Green Camo", rarity: 1, type: "static" },
  { id: "redcamo", name: "Red Camo", rarity: 1, type: "static" },
  { id: "prism", name: "Gemstone", rarity: 2, type: "static" },
  { id: "cherry", name: "Blossom", rarity: 2, type: "static" },
  { id: "vapor", name: "Vaporwave", rarity: 2, type: "static" },
  { id: "swirl", name: "Swirl", rarity: 2, type: "static" },
  { id: "splatter", name: "Marble", rarity: 2, type: "static" },
  { id: "safari", name: "Safari", rarity: 3, type: "static" },
  { id: "money", name: "Pay Day", rarity: 3, type: "static" },
  { id: "snowcamo", name: "Snow Camo", rarity: 3, type: "static" },
  { id: "astro", name: "Astro", rarity: 3, type: "static" },
  { id: "rustic", name: "Royal", rarity: 4, type: "static" },
  { id: "birthday", name: "1st Birthday", rarity: 4, type: "static" },
  { id: "hlwn", name: "HLWN '23", rarity: 4, type: "static" },
  { id: "hallow22", name: "HLWN '22", rarity: 4, type: "static" },
  { id: "summer", name: "Summer '24", rarity: 4, type: "static" },
  { id: "winter", name: "Winter '22", rarity: 4, type: "static" },
  { id: "winter2024", name: "Winter '24", rarity: 4, type: "static" },
  { id: "silly", name: "Silly", rarity: 4, type: "static" },
  { id: "alez", name: "Alez", rarity: 4, type: "static" },
  { id: "ice", name: "Frostbite", rarity: 4, type: "static_nowear" },
];

const SHADER_SKINS = [
  { id: "matrix", name: "Matrix (Shader)", rarity: 4, textures: ["animatedskins/matrix.png"] },
  { id: "neon", name: "Neon (Shader)", rarity: 4, textures: [] },
  { id: "hydro", name: "Hydrodip (Shader)", rarity: 4, textures: ["animatedskins/displacement.png"] },
  { id: "scanline", name: "Scan Line (Shader)", rarity: 4, textures: [] },
  { id: "frostyglow", name: "Frosty Glow (Shader)", rarity: 4, textures: ["animatedskins/ice.png", "animatedskins/ice2.png", "animatedskins/ice3.png"] },
  { id: "neonpulse", name: "Neon Pulse (Shader)", rarity: 4, textures: [] },
  { id: "horizon", name: "Horizon (Shader)", rarity: 4, textures: ["animatedskins/horizon.jpg", "animatedskins/stars.png"] },
  { id: "cloudy", name: "Cloudy (Shader)", rarity: 4, textures: [] },
  { id: "quackster", name: "QuaK (Shader)", rarity: 4, textures: [] },
  { id: "printstream", name: "Printstream (Shader)", rarity: 4, textures: ["animatedskins/printstream/ar2printstream.webp"] },
];

const CHARACTER_ASSETS = [
  { id: "female", name: "Female Operative", path: "character/female.webp" },
  { id: "rookie", name: "Rookie", path: "character/rookie.webp" },
  { id: "tuxedo", name: "Tuxedo", path: "character/tuxedo.webp" },
  { id: "lady", name: "Lady", path: "character/lady.webp" },
  { id: "shotgunplayer", name: "Shotgun Operative", path: "character/shotgunplayer.webp" },
  { id: "glove", name: "First-Person Gloves", path: "character/glove.webp" },
];

const ENVIRONMENT_AND_UI_ASSETS = {
  scopes: [
    { id: "sniperscope", name: "Sniper Scope", path: "textures/sniperscope.webp" },
    { id: "blurredsniperscope", name: "Blurred Scope", path: "textures/blurredsniperscope.webp" },
  ],
  skyboxes: [
    { id: "skybox", name: "Day Skybox", path: "textures/skybox.webp" },
    { id: "sunsetskybox", name: "Sunset Skybox", path: "textures/sunsetskybox.webp" },
    { id: "nightskybox", name: "Night Skybox", path: "textures/nightskybox.webp" },
  ],
  sprays: [
    { id: "duocrown", name: "Duo Crown Spray", path: "textures/sprays/duocrown.png" },
    { id: "feast", name: "Feast Spray", path: "textures/sprays/feast.png" },
    { id: "jackoscope", name: "Jack-o-Scope Spray", path: "textures/sprays/jackoscope.png" },
    { id: "spraytree", name: "Tree Spray", path: "textures/spraytree.png" },
  ],
  promo: [
    { id: "logo", name: "Menu Logo", path: "promo/logo.webp" },
    ...Array.from({ length: 7 }, (_, i) => ({
      id: `background${i}`,
      name: `Lobby Background ${i}`,
      path: `promo/background${i}.webp`,
    })),
  ],
  audio: [
    { id: "good_headshot", name: "Headshot Ding", path: "audio/good_headshot.mp3" },
    { id: "hitmark", name: "Hitmarker", path: "audio/hitmark.mp3" },
    { id: "hit", name: "Hit Confirm", path: "audio/hit.mp3" },
    { id: "kill", name: "Kill SFX", path: "audio/kill.mp3" },
    { id: "killfull", name: "Multi-Kill SFX", path: "audio/killfull.mp3" },
    { id: "death", name: "Death SFX", path: "audio/death.mp3" },
    { id: "scar2", name: "AR Fire", path: "audio/scar2.mp3" },
    { id: "famas", name: "Burst/SMG Fire", path: "audio/famas.mp3" },
    { id: "heavy sniper", name: "AWP Fire", path: "audio/heavy sniper.mp3" },
    { id: "shotgun", name: "Shotgun Fire", path: "audio/shotgun.mp3" },
    { id: "pistol", name: "Pistol Fire", path: "audio/pistol.wav" },
    { id: "lmg", name: "LMG Fire", path: "audio/lmg.wav" },
    { id: "reload", name: "Reload SFX", path: "audio/reload.mp3" },
    { id: "scope", name: "Scope Zoom", path: "audio/scope.mp3" },
    { id: "click", name: "UI Click", path: "audio/click.mp3" },
  ],
};

const MAPS = [
  { id: "industry", name: "Refinery", location: "Amsterdam, Netherlands", folder: "industry/out/" },
  { id: "factory", name: "Factory", location: "Industrial Sector", folder: "maps/tf/" },
  { id: "neon", name: "Neon", location: "Cyber District", folder: "maps/neon/" },
  { id: "manor", name: "Manor", location: "Estate Grounds", folder: "maps/manor/" },
  { id: "winter", name: "Snowfall", location: "Alpine Ridge", folder: "maps/winter/" },
  { id: "newmlab", name: "Vineyard / Lab", location: "Valley Outpost", folder: "maps/newmlab/" },
];

/**
 * Exact indices inside localStorage['dsio:settings:2'] observed from Deadshot.io bundle.
 */
const DSIO_SETTINGS_KEYS = [
  "region", "language", "volume", "sfxvolume", "ambientvolume", "rawmouse",
  "inversemouse", "sensitivity", "zoom", "antialias", "fullscreen", "showstats",
  "renderscale", "clrblnd", "sightcolor", "statichair", "toggleads", "static",
  "xhairthickness", "xhairlength", "xhairred", "xhairgreen", "xhairblue",
  "xhairalpha", "xhairdot", "xhairoutline", "xhairoutlinealpha", "xhairbloom",
  "lefthand", "autoads", "autoshoot", "version", "fptracers", "regionmeta",
  "snowfall", "fieldofview",
];

const DSIO_KEYBIND_KEYS = [
  "up", "down", "left", "right", "space", "crouch", "reload", "chat", "pause",
  "leaderboard", "ads", "shoot", "realCrouch", "inspect", "sprayGun", "sprayTree",
  "partyChat", "switchWeapon", "slot1", "slot2", "nadeSmoke", "nadeFlash",
  "nadeMolly", "bombSlot", "useKey", "buyMenu", "dropKey", "knifeSlot", "quickChatKey",
];

const STORAGE_KEYS = [
  "dsio:settings:2",
  "dsio:keybinds:2",
  "dsio:prefs:1",
  "dsio:controller:1",
  "dsio:mobilelayout:1",
];

function buildOfficialSkinUrl(skinId, weaponId, wear = 0) {
  if (!skinId || skinId === "default") {
    const w = WEAPONS[weaponId];
    return w ? `https://deadshot.io/${w.texture}` : null;
  }
  const skinMeta = OFFICIAL_SKINS.find((s) => s.id === skinId);
  if (skinMeta && skinMeta.type === "static_nowear") {
    return `https://deadshot.io/skins/compressed/${skinId}${weaponId}.webp`;
  }
  const clampedWear = Math.max(0, Math.min(4, Number(wear) || 0));
  return `https://deadshot.io/skins/compressed/${skinId}${weaponId}${clampedWear}.webp`;
}

module.exports = {
  WEAPONS,
  MELEE_AND_UTILITY_MODELS,
  OFFICIAL_SKINS,
  SHADER_SKINS,
  CHARACTER_ASSETS,
  ENVIRONMENT_AND_UI_ASSETS,
  MAPS,
  DSIO_SETTINGS_KEYS,
  DSIO_KEYBIND_KEYS,
  STORAGE_KEYS,
  buildOfficialSkinUrl,
};
