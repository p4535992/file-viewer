// Self-contained synthetic sfnt/CFF resources: no system or third-party fonts.
use stet_core::{context::Context, dict::DictKey, object::PsValue};

fn sfnt(flavor: &[u8; 4], tables: Vec<(&[u8; 4], Vec<u8>)>) -> Vec<u8> {
    let mut out = flavor.to_vec();
    out.extend((tables.len() as u16).to_be_bytes());
    out.extend([0u8; 6]);
    let mut offset = 12 + 16 * tables.len();
    let mut bodies = Vec::new();
    for (tag, bytes) in tables {
        out.extend(tag);
        out.extend([0u8; 4]);
        out.extend((offset as u32).to_be_bytes());
        out.extend((bytes.len() as u32).to_be_bytes());
        let mut padded = bytes;
        padded.resize(padded.len().div_ceil(4) * 4, 0);
        offset += padded.len();
        bodies.extend(padded);
    }
    out.extend(bodies);
    out
}

fn ttf() -> Vec<u8> {
    let mut head = vec![0u8; 54];
    head[12..16].copy_from_slice(&0x5F0F_3CF5u32.to_be_bytes());
    head[18..20].copy_from_slice(&1000u16.to_be_bytes());
    let mut name = Vec::new();
    for v in [0u16, 1, 18, 1, 0, 0, 6, 8, 0] {
        name.extend(v.to_be_bytes());
    }
    name.extend(b"ProbeTTF");
    let mut cmap = Vec::new();
    for v in [0u16, 1, 3, 10] { cmap.extend(v.to_be_bytes()); }
    cmap.extend(12u32.to_be_bytes());
    cmap.extend(12u16.to_be_bytes());
    cmap.extend(0u16.to_be_bytes());
    for v in [28u32, 0, 1, 65, 65, 1] { cmap.extend(v.to_be_bytes()); }
    sfnt(&[0, 1, 0, 0], vec![(b"cmap", cmap), (b"head", head), (b"name", name)])
}

fn otf() -> Vec<u8> {
    // CFF 1.0: one name, one Top DICT pointing at the CharStrings INDEX,
    // empty strings/global subrs, and a single .notdef endchar program.
    let mut cff = vec![1, 0, 4, 4, 0, 1, 1, 1, 9];
    cff.extend(b"ProbeCFF");
    cff.extend([0, 1, 1, 1, 3, 167, 17, 0, 0, 0, 0]);
    assert_eq!(cff.len(), 28);
    cff.extend([0, 1, 1, 1, 2, 14]);
    sfnt(b"OTTO", vec![(b"CFF ", cff)])
}

fn embedded_load(bytes: Vec<u8>, filename: &str, font: &str, expected_type: i32) {
    let mut ctx = Context::new();
    stet_ops::build_system_dict(&mut ctx);
    ctx.exec_sync_fn = Some(stet_engine::eval::exec_sync);
    ctx.files.add_embedded_file(filename, Box::leak(bytes.into_boxed_slice()));
    let source = format!("/Probe (/{}//{}) .loadbinaryfontfile", "Font", filename.trim_start_matches("Font/"));
    stet_engine::eval::parse_and_exec(&mut ctx, source.as_bytes()).unwrap();
    assert!(matches!(ctx.o_stack.pop().unwrap().value, PsValue::Bool(true)));
    let key = DictKey::Name(ctx.names.intern(font.as_bytes()));
    let entry = ctx.dicts.get(ctx.font_directory, &key).expect("font registered");
    let PsValue::Dict(entity) = entry.value else { panic!("font dictionary expected") };
    let value = ctx.dicts.get(entity, &DictKey::Name(ctx.name_cache.n_font_type)).unwrap();
    assert_eq!(value.as_i32(), Some(expected_type));
}

#[test]
fn embedded_truetype_registers_type42() { embedded_load(ttf(), "Font/Probe.ttf", "ProbeTTF", 42); }

#[test]
fn embedded_cff_opentype_registers_type2() { embedded_load(otf(), "Font/Probe.otf", "ProbeCFF", 2); }
