use std::collections::BTreeSet;
use gutenberg_compose::ComposedStory;

/// A repeated table header and a new empty page are not semantic progress.
#[derive(Default, PartialEq, Eq)]
pub struct Progress {
    end: usize,
    cells: BTreeSet<(u64, usize, usize)>,
    objects: BTreeSet<usize>,
    notes: BTreeSet<u64>,
}

pub fn progress(cs: &ComposedStory) -> Progress {
    let mut p=Progress::default();
    for f in &cs.frames {
        p.end=p.end.max(f.range.end);
        for t in &f.tables { for c in &t.cells { if !c.repeated { p.cells.insert((t.table,c.row,c.col)); } } }
        for o in &f.objects { p.objects.insert(o.index); }
        for n in &f.notes { p.notes.insert(n.id); }
    }
    p
}

pub fn validate(cs:&ComposedStory)->Result<(),String> {
    if cs.overset_at.is_some() { return Err(format!("overset at UTF8 byte {:?}",cs.overset_at)); }
    if cs.styles.iter().any(|s|s.missing_font) { return Err("missing-font".into()); }
    for f in &cs.frames {
        for l in &f.lines { for g in &l.glyphs { if g.visible && g.gid==0 { return Err(format!("missing-glyph at UTF8 byte {}",g.byte)); } } }
        for t in &f.tables { for c in &t.cells {
            // Fixed cells can clip while their nested ComposedStory says no overset.
            if c.overset { return Err(format!("table-cell-overset row {} column {}",c.row,c.col)); }
            validate(&c.text)?;
        } }
        for n in &f.notes { validate(&n.text)?; }
    }
    Ok(())
}
