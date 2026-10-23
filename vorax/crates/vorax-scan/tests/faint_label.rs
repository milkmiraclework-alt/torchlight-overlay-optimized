//! Optional saved-frame diagnostic; no game window, capture or input.
#[test]
fn faint_label_saved_frame() {
    let Ok(file) = std::env::var("VORAX_FAINT_FRAME") else { return; };
    let decoder = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(file).unwrap()));
    let mut reader = decoder.read_info().unwrap();
    let mut bytes = vec![0; reader.output_buffer_size()]; let info = reader.next_frame(&mut bytes).unwrap();
    let data = match info.color_type { png::ColorType::Rgba => bytes[..info.buffer_size()].to_vec(),
        png::ColorType::Rgb => bytes[..info.buffer_size()].chunks_exact(3).flat_map(|p| [p[0],p[1],p[2],255]).collect(), _ => panic!("RGB/RGBA PNG required") };
    let img = vorax_scan::Img { width: info.width as usize, height: info.height as usize, data };
    let l = vorax_scan::layout::layout(img.width, img.height); let g = vorax_scan::pixels::gray(&img); let refs = &vorax_scan::scan_data().digits["label"];
    let i = 5;
    eprintln!("faint: {:?} {:?}", vorax_scan::text::brightest(&img,&l.name_band[i]), vorax_scan::text::brightest_short_name(&img,&l.name_band[i]));
    eprintln!("total: {:?}", vorax_scan::text::read_text(&img,&g,&l.total_band[i],vorax_scan::text::TextKind::Label,refs));
    eprintln!("aq: {:?}", vorax_scan::text::read_text(&img,&g,&l.aq_band[i],vorax_scan::text::TextKind::Label,refs));
    let got = vorax_scan::tanks::read_tank(&img, &g, &l, i, vorax_scan::scan_data(), true);
    assert!(!got.fields["tank5.activity"].sure);
    assert!(!got.fields["tank5.quantity"].sure);
    assert!(got.monster.is_some(), "a visible short name with consistent digits must not be empty");
    let monster = got.monster.unwrap(); assert_eq!((monster.activity,monster.quantity),(1,36));
}

#[test]
fn a_faint_neutral_glint_without_printed_digits_is_empty() {
    let mut img = vorax_scan::Img::new(1280,720);
    for pixel in img.data.chunks_exact_mut(4) { pixel.copy_from_slice(&[50,50,50,255]); }
    let layout = vorax_scan::layout::layout(img.width,img.height);
    let band = layout.name_band[5];
    for y in band.y as usize..band.y as usize+3 { for x in band.x as usize..band.x as usize+6 {
        img.data[(y*img.width+x)*4..(y*img.width+x)*4+4].copy_from_slice(&[255,255,255,255]);
    }}
    assert!(vorax_scan::text::brightest(&img,&band)[0] < 105.0);
    assert!(vorax_scan::text::brightest_short_name(&img,&band)[0] >= 105.0);
    let gray = vorax_scan::pixels::gray(&img);
    let got = vorax_scan::tanks::read_tank(&img,&gray,&layout,5,vorax_scan::scan_data(),true);
    assert!(got.monster.is_none());
    assert!(got.fields["tank5.empty"].sure);
}
