fn main() {
    let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap_or_default()).join("craft_fonts.rs");
    if let Err(error) = std::fs::write(out, "pub static CRAFT_FONTS: &[CraftFont] = &[];\n") {
        println!("cargo::error={error}");
    }
}
