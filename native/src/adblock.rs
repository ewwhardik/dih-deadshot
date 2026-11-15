/// Lightweight host/path ad & tracker blocklist for Deadshot.io.
/// Never touches game JS/WASM/asset/matchmaking endpoints.
pub const AD_FILTER_PATTERNS: &[&str] = &[
    "*://*.doubleclick.net/*",
    "*://doubleclick.net/*",
    "*://*.googlesyndication.com/*",
    "*://googlesyndication.com/*",
    "*://*.googletagservices.com/*",
    "*://*.googletagmanager.com/*",
    "*://*.google-analytics.com/*",
    "*://adservice.google.*/*",
    "*://*.adinplay.com/*",
    "*://adinplay.com/*",
    "*://*.adnxs.com/*",
    "*://*.amazon-adsystem.com/*",
    "*://*.pubmatic.com/*",
    "*://*.rubiconproject.com/*",
    "*://*.openx.net/*",
    "*://*.criteo.com/*",
    "*://*.taboola.com/*",
    "*://*.outbrain.com/*",
    "*://*.casalemedia.com/*",
    "*://*.3lift.com/*",
    "*://*.smartadserver.com/*",
    "*://*.indexww.com/*",
    "*://*.scorecardresearch.com/*",
    "*://*.quantserve.com/*",
    "*://*.hotjar.com/*",
    "*://*.sentry.io/*",
    "*://*.mixpanel.com/*",
    "*://*.amplitude.com/*",
    "*://*.poki-gdn.com/*",
    "*://*.crazygames.com/ads*",
    "*://crazygames.com/ads*",
];

pub fn is_ad_or_tracker_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let Some(rest) = lower.strip_prefix("http://").or_else(|| lower.strip_prefix("https://")) else {
        return false;
    };
    let (authority, path_and_query) = match rest.find(['/', '?']) {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, "/"),
    };
    let host = if authority.starts_with('[') {
        authority
    } else {
        authority.split(':').next().unwrap_or(authority)
    };
    if host.is_empty()
        || host == "deadshot.io"
        || host.ends_with(".deadshot.io")
        || host == "dih.local"
        || host.ends_with(".dih.local")
        || host == "localhost"
        || host == "127.0.0.1"
    {
        return false;
    }

    if host.starts_with("adservice.google.") {
        return true;
    }
    if (host == "crazygames.com" || host.ends_with(".crazygames.com"))
        && path_and_query.starts_with("/ads")
    {
        return true;
    }

    const BLOCKED_HOSTS: &[&str] = &[
        "doubleclick.net",
        "googlesyndication.com",
        "googletagservices.com",
        "googletagmanager.com",
        "google-analytics.com",
        "pagead2.googlesyndication.com",
        "adinplay.com",
        "adnxs.com",
        "amazon-adsystem.com",
        "pubmatic.com",
        "rubiconproject.com",
        "openx.net",
        "criteo.com",
        "taboola.com",
        "outbrain.com",
        "casalemedia.com",
        "3lift.com",
        "smartadserver.com",
        "indexww.com",
        "scorecardresearch.com",
        "quantserve.com",
        "hotjar.com",
        "sentry.io",
        "mixpanel.com",
        "amplitude.com",
        "poki-gdn.com",
    ];

    for pat in BLOCKED_HOSTS {
        if host == *pat || host.ends_with(&format!(".{pat}")) {
            return true;
        }
    }
    false
}
