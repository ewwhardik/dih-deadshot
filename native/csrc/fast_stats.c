/**
 * Dih Native C Telemetry Math Kernel (freestanding C, zero SDK header dependencies).
 * Compiled cleanly with MSVC x64 cl.exe (/O2 /GS- /Zl) and linked into Dih.exe.
 */

#ifdef DIH_PROVIDE_FLTUSED
int _fltused = 0;
#endif

typedef unsigned long long dih_size_t;

void dih_calc_fps_stats(
    const double* frame_ms,
    dih_size_t count,
    double* out_fps,
    double* out_1pct_low,
    double* out_avg_ms
) {
    if (!frame_ms || count == 0) {
        if (out_fps) *out_fps = 0.0;
        if (out_1pct_low) *out_1pct_low = 0.0;
        if (out_avg_ms) *out_avg_ms = 0.0;
        return;
    }

    double buf[256];
    dih_size_t n = count > 256 ? 256 : count;
    dih_size_t start = count - n;
    double sum = 0.0;

    for (dih_size_t i = 0; i < n; i++) {
        double v = frame_ms[start + i];
        if (v < 0.05) v = 0.05;
        if (v > 250.0) v = 250.0;
        buf[i] = v;
        sum += v;
    }

    // Insertion sort rolling window in descending frametime order
    for (dih_size_t i = 1; i < n; i++) {
        double key = buf[i];
        dih_size_t j = i;
        while (j > 0 && buf[j - 1] < key) {
            buf[j] = buf[j - 1];
            j--;
        }
        buf[j] = key;
    }

    double avg = sum / (double)n;
    dih_size_t top1_count = n / 100;
    if (top1_count < 1) top1_count = 1;

    double worst_sum = 0.0;
    for (dih_size_t i = 0; i < top1_count; i++) {
        worst_sum += buf[i];
    }
    double worst_avg = worst_sum / (double)top1_count;

    if (out_avg_ms) *out_avg_ms = avg;
    if (out_fps) *out_fps = avg > 0.0 ? (1000.0 / avg) : 0.0;
    if (out_1pct_low) *out_1pct_low = worst_avg > 0.0 ? (1000.0 / worst_avg) : 0.0;
}

void dih_calc_jitter(const double* rtts, dih_size_t count, double* out_mean, double* out_jitter) {
    if (!rtts || count == 0) {
        if (out_mean) *out_mean = 0.0;
        if (out_jitter) *out_jitter = 0.0;
        return;
    }

    double sum = 0.0;
    for (dih_size_t i = 0; i < count; i++) sum += rtts[i];
    double mean = sum / (double)count;

    double jitter = 0.0;
    for (dih_size_t i = 1; i < count; i++) {
        double diff = rtts[i] - rtts[i - 1];
        if (diff < 0.0) diff = -diff;
        jitter += (diff - jitter) / 16.0;
    }

    if (out_mean) *out_mean = mean;
    if (out_jitter) *out_jitter = jitter;
}
