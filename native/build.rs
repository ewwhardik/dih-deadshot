use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo_root = manifest_dir.parent().unwrap().to_path_buf();
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    println!("cargo:rerun-if-changed=../src/data/defaultSettings.js");
    println!("cargo:rerun-if-changed=../src/data/deadshotCatalog.js");
    println!("cargo:rerun-if-changed=../src/data/featureRegistry.js");
    println!("cargo:rerun-if-changed=../assets/dih-icon.ico");
    println!("cargo:rerun-if-changed=csrc/fast_stats.c");

    generate_catalog_json(&repo_root, &out_dir);
    configure_gnullvm_runtime(&out_dir);
    compile_c_kernel(&manifest_dir, &out_dir);
    compile_win32_resources(&repo_root, &out_dir);
}

fn find_rust_sysroot() -> Option<PathBuf> {
    let rustc = env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
    let out = Command::new(rustc).args(["--print", "sysroot"]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(PathBuf::from(path))
    }
}

fn configure_gnullvm_runtime(out_dir: &Path) {
    if env::var("TARGET").as_deref() != Ok("x86_64-pc-windows-gnullvm") {
        return;
    }
    let Some(sysroot) = find_rust_sysroot() else {
        return;
    };
    let gnu_sc = sysroot
        .join("lib")
        .join("rustlib")
        .join("x86_64-pc-windows-gnu")
        .join("lib")
        .join("self-contained");
    let gnu_crt = gnu_sc.join("crt2.o");

    if gnu_sc.exists() {
        println!("cargo:rustc-link-search=native={}", gnu_sc.display());
        let gcc_eh = gnu_sc.join("libgcc_eh.a");
        let shim_unwind = out_dir.join("libunwind.a");
        if gcc_eh.exists() {
            let _ = fs::copy(&gcc_eh, &shim_unwind);
            println!("cargo:rustc-link-search=native={}", out_dir.display());
        }
    }
    if gnu_crt.exists() {
        println!("cargo:rustc-link-arg={}", gnu_crt.display());
        println!("cargo:rustc-link-arg=-lmingw32");
        println!("cargo:rustc-link-arg=-lmingwex");
        println!("cargo:rustc-link-arg=-lmsvcrt");
        println!("cargo:rustc-link-arg=-lgcc");
        println!("cargo:rustc-link-arg=-lkernel32");
    }
}

fn generate_catalog_json(repo_root: &Path, out_dir: &Path) {
    let dst = out_dir.join("catalog.json");
    let script = r#"
const ds = require('./src/data/defaultSettings.js');
const cat = require('./src/data/deadshotCatalog.js');
const reg = require('./src/data/featureRegistry.js');
console.log(JSON.stringify({
  THEME_PRESETS: ds.THEME_PRESETS,
  DEFAULT_SETTINGS: ds.DEFAULT_SETTINGS,
  WEAPONS: cat.WEAPONS,
  MELEE_AND_UTILITY_MODELS: cat.MELEE_AND_UTILITY_MODELS,
  OFFICIAL_SKINS: cat.OFFICIAL_SKINS,
  SHADER_SKINS: cat.SHADER_SKINS,
  CHARACTER_ASSETS: cat.CHARACTER_ASSETS,
  ENVIRONMENT_AND_UI_ASSETS: cat.ENVIRONMENT_AND_UI_ASSETS,
  MAPS: cat.MAPS,
  DSIO_SETTINGS_KEYS: cat.DSIO_SETTINGS_KEYS,
  DSIO_KEYBIND_KEYS: cat.DSIO_KEYBIND_KEYS,
  STORAGE_KEYS: cat.STORAGE_KEYS,
  FEATURE_CATEGORIES: reg.FEATURE_CATEGORIES,
  FEATURE_REGISTRY: reg.FEATURE_REGISTRY,
}));
"#;
    let out = Command::new("node")
        .current_dir(repo_root)
        .args(["-e", script])
        .output()
        .expect("Node.js is required at build time to serialize catalog.json");
    assert!(
        out.status.success(),
        "Failed to serialize catalog.json via node: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    fs::write(&dst, &out.stdout).unwrap();
}

fn find_msvc_tool(name: &str) -> Option<PathBuf> {
    let base = Path::new(r"C:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC");
    if let Ok(entries) = fs::read_dir(base) {
        let mut versions: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        versions.sort();
        if let Some(ver) = versions.pop() {
            let candidate = ver.join(r"bin\Hostx64\x64").join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    let vs22 = Path::new(r"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC");
    if let Ok(entries) = fs::read_dir(vs22) {
        if let Some(ver) = entries.flatten().map(|e| e.path()).next() {
            let candidate = ver.join(r"bin\Hostx64\x64").join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn compile_c_kernel(manifest_dir: &Path, out_dir: &Path) {
    let c_src = manifest_dir.join("csrc").join("fast_stats.c");
    let obj_out = out_dir.join("fast_stats.obj");
    let is_gnullvm = env::var("TARGET").as_deref() == Ok("x86_64-pc-windows-gnullvm");
    if let Some(cl) = find_msvc_tool("cl.exe") {
        let mut cmd = Command::new(&cl);
        cmd.args([
            "/nologo",
            "/c",
            "/O2",
            "/GS-",
            "/Zl",
            "/TC",
        ]);
        if is_gnullvm {
            cmd.arg("/DDIH_PROVIDE_FLTUSED");
        }
        let status = cmd
            .arg(format!("/Fo{}", obj_out.display()))
            .arg(&c_src)
            .status()
            .expect("Failed to execute cl.exe");
        assert!(status.success(), "cl.exe failed compiling fast_stats.c");
        println!("cargo:rustc-link-arg={}", obj_out.display());
    } else {
        panic!("MSVC cl.exe not found to compile csrc/fast_stats.c");
    }
}

// --- Pure Rust Microsoft .RES serializer + cvtres.exe COFF linker (no rc.exe required) ---
fn align4(buf: &mut Vec<u8>) {
    while buf.len() % 4 != 0 {
        buf.push(0);
    }
}

fn push_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn push_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn push_wstr(buf: &mut Vec<u8>, s: &str) {
    for u in s.encode_utf16() {
        push_u16(buf, u);
    }
    push_u16(buf, 0);
}

fn write_res_entry(out: &mut Vec<u8>, res_type: u16, res_id: u16, lang: u16, data: &[u8]) {
    let mut hdr = Vec::new();
    push_u32(&mut hdr, data.len() as u32); // DataSize
    push_u32(&mut hdr, 0); // HeaderSize placeholder
    // TYPE (numeric ordinal: 0xFFFF, ID)
    push_u16(&mut hdr, 0xFFFF);
    push_u16(&mut hdr, res_type);
    // NAME (numeric ordinal: 0xFFFF, ID)
    push_u16(&mut hdr, 0xFFFF);
    push_u16(&mut hdr, res_id);
    align4(&mut hdr);
    push_u32(&mut hdr, 0); // DataVersion
    push_u16(&mut hdr, 0x1030); // MemoryFlags (MOVEABLE | PURE | DISCARDABLE)
    push_u16(&mut hdr, lang); // LanguageId (0x0409)
    push_u32(&mut hdr, 0); // Version
    push_u32(&mut hdr, 0); // Characteristics
    align4(&mut hdr);

    let hdr_len = hdr.len() as u32;
    hdr[4..8].copy_from_slice(&hdr_len.to_le_bytes());

    out.extend_from_slice(&hdr);
    out.extend_from_slice(data);
    align4(out);
}

fn build_version_node<F: FnOnce(&mut Vec<u8>)>(key: &str, value_bytes: &[u8], w_type: u16, value_len_units: u16, children_fn: F) -> Vec<u8> {
    let mut node = Vec::new();
    push_u16(&mut node, 0); // wLength placeholder
    push_u16(&mut node, value_len_units);
    push_u16(&mut node, w_type);
    push_wstr(&mut node, key);
    align4(&mut node);
    if !value_bytes.is_empty() {
        node.extend_from_slice(value_bytes);
        align4(&mut node);
    }
    children_fn(&mut node);
    align4(&mut node);
    let len = node.len() as u16;
    node[0..2].copy_from_slice(&len.to_le_bytes());
    node
}

fn build_version_resource() -> Vec<u8> {
    // VS_FIXEDFILEINFO (52 bytes)
    let mut fixed = Vec::new();
    push_u32(&mut fixed, 0xFEEF04BD); // dwSignature
    push_u32(&mut fixed, 0x00010000); // dwStrucVersion
    push_u32(&mut fixed, 0x00000003); // dwFileVersionMS (0.3)
    push_u32(&mut fixed, 0x00000000); // dwFileVersionLS (0.0)
    push_u32(&mut fixed, 0x00000003); // dwProductVersionMS (0.3)
    push_u32(&mut fixed, 0x00000000); // dwProductVersionLS (0.0)
    push_u32(&mut fixed, 0x0000003F); // dwFileFlagsMask
    push_u32(&mut fixed, 0);          // dwFileFlags
    push_u32(&mut fixed, 0x00040004); // dwFileOS (VOS_NT_WINDOWS32)
    push_u32(&mut fixed, 0x00000001); // dwFileType (VFT_APP)
    push_u32(&mut fixed, 0);          // dwFileSubtype
    push_u32(&mut fixed, 0);
    push_u32(&mut fixed, 0);

    let pairs = [
        ("CompanyName", "ewwhardik"),
        ("FileDescription", "Dih - Native Uncapped Deadshot.io Client"),
        ("FileVersion", "0.3.0.0"),
        ("InternalName", "Dih"),
        ("LegalCopyright", "ewwhardik (GitHub & Discord: ewwhardik)"),
        ("OriginalFilename", "Dih.exe"),
        ("ProductName", "Dih Client"),
        ("ProductVersion", "0.3.0.0"),
        ("Comments", "Minimalist High-FPS Deadshot.io Client | GitHub: ewwhardik | Discord: ewwhardik"),
    ];

    let string_table = build_version_node("040904B0", &[], 1, 0, |children| {
        for (k, v) in pairs {
            let mut wval = Vec::new();
            push_wstr(&mut wval, v);
            let wchars = (wval.len() / 2) as u16;
            let entry = build_version_node(k, &wval, 1, wchars, |_| {});
            children.extend_from_slice(&entry);
        }
    });

    let string_file_info = build_version_node("StringFileInfo", &[], 1, 0, |children| {
        children.extend_from_slice(&string_table);
    });

    let var_entry = build_version_node("Translation", &[0x09, 0x04, 0xB0, 0x04], 0, 4, |_| {});
    let var_file_info = build_version_node("VarFileInfo", &[], 1, 0, |children| {
        children.extend_from_slice(&var_entry);
    });

    build_version_node("VS_VERSION_INFO", &fixed, 0, fixed.len() as u16, |children| {
        children.extend_from_slice(&string_file_info);
        children.extend_from_slice(&var_file_info);
    })
}

fn compile_win32_resources(repo_root: &Path, out_dir: &Path) {
    let ico_path = repo_root.join("assets").join("dih-icon.ico");
    let ico = fs::read(&ico_path).expect("Missing assets/dih-icon.ico");
    let count = u16::from_le_bytes([ico[4], ico[5]]) as usize;

    let mut res = Vec::new();
    // Standard Win32 32-byte null resource header at start of .res file
    res.extend_from_slice(&[
        0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00,
        0xFF, 0xFF, 0x00, 0x00, 0xFF, 0xFF, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);

    // Build RT_GROUP_ICON (type 14, id 1) + RT_ICON (type 3, id 1..N)
    let mut group = Vec::new();
    group.extend_from_slice(&ico[0..6]); // idReserved, idType=1, idCount
    for i in 0..count {
        let dir_off = 6 + i * 16;
        let bytes_in_res = u32::from_le_bytes(ico[dir_off + 8..dir_off + 12].try_into().unwrap()) as usize;
        let img_offset = u32::from_le_bytes(ico[dir_off + 12..dir_off + 16].try_into().unwrap()) as usize;
        group.extend_from_slice(&ico[dir_off..dir_off + 12]);
        let icon_id = (i + 1) as u16;
        push_u16(&mut group, icon_id);
        write_res_entry(&mut res, 3, icon_id, 0x0409, &ico[img_offset..img_offset + bytes_in_res]);
    }
    write_res_entry(&mut res, 14, 1, 0x0409, &group);

    let ver = build_version_resource();
    write_res_entry(&mut res, 16, 1, 0x0409, &ver);

    let res_path = out_dir.join("dih.res");
    let obj_path = out_dir.join("dih_res.obj");
    fs::write(&res_path, &res).unwrap();

    let cvtres = find_msvc_tool("cvtres.exe").expect("MSVC cvtres.exe required to link Win32 resources");
    let status = Command::new(&cvtres)
        .args([
            "/MACHINE:X64",
            "/NOLOGO",
            &format!("/OUT:{}", obj_path.display()),
        ])
        .arg(&res_path)
        .status()
        .expect("Failed to run cvtres.exe");
    assert!(status.success(), "cvtres.exe failed converting dih.res");
    println!("cargo:rustc-link-arg={}", obj_path.display());
}
