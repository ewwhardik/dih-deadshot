/// Comprehensive non-destructive ad, header-bidding & tracker blocklist for Deadshot.io.
/// Returns harmless 200 JS/JSON/HTML stubs so anti-adblock scripts never trigger error guards.
pub const AD_FILTER_PATTERNS: &[&str] = &[
    "*://*.doubleclick.net/*",
    "*://doubleclick.net/*",
    "*://*.googlesyndication.com/*",
    "*://googlesyndication.com/*",
    "*://*.googletagservices.com/*",
    "*://*.googletagmanager.com/*",
    "*://*.google-analytics.com/*",
    "*://adservice.google.*/*",
    "*://*.adtrafficquality.google/*",
    "*://fundingchoicesmessages.google.com/*",
    "*://*.vntsm.com/*",
    "*://vntsm.com/*",
    "*://*.vntsm.io/*",
    "*://vntsm.io/*",
    "*://*.venatusmedia.com/*",
    "*://venatusmedia.com/*",
    "*://*.atmtd.com/*",
    "*://atmtd.com/*",
    "*://*.bids.ws/*",
    "*://*.360yield.com/*",
    "*://*.the-ozone-project.com/*",
    "*://*.onetag-sys.com/*",
    "*://*.ccgateway.net/*",
    "*://*.id5-sync.com/*",
    "*://id5-sync.com/*",
    "*://*.inmobi.com/*",
    "*://*.affec.tv/*",
    "*://*.smilewanted.com/*",
    "*://*.ad-delivery.net/*",
    "*://*.rlcdn.com/*",
    "*://*.adsrvr.org/*",
    "*://*.script.ac/*",
    "*://*.fastclick.net/*",
    "*://*.connatix.com/*",
    "*://*.clean.gg/*",
    "*://*.adsafeprotected.com/*",
    "*://*.adingo.jp/*",
    "*://*.adform.net/*",
    "*://*.bidswitch.net/*",
    "*://*.sharethrough.com/*",
    "*://*.sonobi.com/*",
    "*://*.lijit.com/*",
    "*://*.gumgum.com/*",
    "*://*.yieldmo.com/*",
    "*://*.kargo.com/*",
    "*://*.media.net/*",
    "*://*.teads.tv/*",
    "*://*.prebid.org/*",
    "*://ups.analytics.yahoo.com/*",
    "*://static.cloudflareinsights.com/*",
    "*://*.adinplay.com/*",
    "*://adinplay.com/*",
    "*://*.adnxs.com/*",
    "*://*.amazon-adsystem.com/*",
    "*://*.pubmatic.com/*",
    "*://*.rubiconproject.com/*",
    "*://*.openx.net/*",
    "*://*.criteo.com/*",
    "*://*.criteo.net/*",
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
        "adtrafficquality.google",
        "fundingchoicesmessages.google.com",
        "vntsm.com",
        "vntsm.io",
        "venatusmedia.com",
        "atmtd.com",
        "bids.ws",
        "360yield.com",
        "the-ozone-project.com",
        "onetag-sys.com",
        "ccgateway.net",
        "id5-sync.com",
        "inmobi.com",
        "affec.tv",
        "smilewanted.com",
        "ad-delivery.net",
        "rlcdn.com",
        "adsrvr.org",
        "script.ac",
        "fastclick.net",
        "connatix.com",
        "clean.gg",
        "adsafeprotected.com",
        "adingo.jp",
        "adform.net",
        "bidswitch.net",
        "sharethrough.com",
        "sonobi.com",
        "lijit.com",
        "gumgum.com",
        "yieldmo.com",
        "kargo.com",
        "media.net",
        "teads.tv",
        "prebid.org",
        "ups.analytics.yahoo.com",
        "static.cloudflareinsights.com",
        "adinplay.com",
        "adnxs.com",
        "amazon-adsystem.com",
        "pubmatic.com",
        "rubiconproject.com",
        "openx.net",
        "criteo.com",
        "criteo.net",
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

/// Returns harmless HTTP status, MIME type & empty/no-op body so ad loaders never throw anti-adblock errors.
pub fn blocked_ad_response(url: &str) -> (u16, &'static str, &'static str, &'static [u8]) {
    let clean = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
    if clean.ends_with(".js")
        || clean.ends_with(".mjs")
        || clean.contains("ad-manager")
        || clean.contains("/vms/")
    {
        return (
            200,
            "OK",
            "application/javascript; charset=utf-8",
            b"/* blocked */\n",
        );
    }
    if clean.ends_with(".json") || clean.contains("bids") || clean.contains("prebid") {
        return (200, "OK", "application/json; charset=utf-8", b"{}");
    }
    if clean.ends_with(".css") {
        return (200, "OK", "text/css; charset=utf-8", b"");
    }
    if clean.ends_with(".html") || clean.ends_with(".htm") || clean.contains("iframe") {
        return (200, "OK", "text/html; charset=utf-8", b"");
    }
    (204, "No Content", "text/plain", b"")
}
