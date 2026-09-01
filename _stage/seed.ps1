Set-Location 'C:\Users\luism\Desktop\Proyectos independientes\Writers hoard desktop'
$P = 'proj_mthy3jeu_q7kvd1'
function Wh([string]$tool, [string]$json) {
  $out = node scripts/wh-bridge.mjs call $tool $json 2>&1 | Out-String
  Write-Output ("--- $tool : " + $out.Trim().Substring(0, [Math]::Min(160, $out.Trim().Length)))
}
Wh wh_enable_engine ('{"projectId":"' + $P + '","engineId":"seeds"}')
Wh wh_enable_engine ('{"projectId":"' + $P + '","engineId":"outline"}')
Wh wh_create_writing ('{"projectId":"' + $P + '","title":"Capitulo 1","chapter":1,"content":"Aurelia cruzo el patio al alba. Marek la seguia de lejos."}')
Wh wh_create_writing ('{"projectId":"' + $P + '","title":"Capitulo 2","chapter":2,"content":"Aurelia hablo con el herrero. Marek callaba."}')
Wh wh_create_writing ('{"projectId":"' + $P + '","title":"Capitulo 3","chapter":3,"content":"Marek encontro la carta escondida bajo la piedra."}')
Wh wh_create_writing ('{"projectId":"' + $P + '","title":"Capitulo 4","chapter":4,"content":"Marek volvio al patio. Nadie lo esperaba."}')
Wh wh_create_writing ('{"projectId":"' + $P + '","title":"Capitulo 5","chapter":5,"content":"Marek quemo la carta y salio de la ciudad."}')
Wh wh_create_writing ('{"projectId":"' + $P + '","title":"Capitulo 6","chapter":6,"content":"Marek llego al mar. El viaje habia terminado."}')
Wh wh_create_codex_entry ('{"projectId":"' + $P + '","title":"Aurelia","type":"character","content":"Hija del herrero."}')
Wh wh_create_codex_entry ('{"projectId":"' + $P + '","title":"Marek","type":"character","content":"Un mensajero."}')
Wh wh_create_seed ('{"projectId":"' + $P + '","title":"La carta escondida","description":"Se planta en el capitulo 3 y nunca se resuelve."}')
Wh wh_create_outline ('{"projectId":"' + $P + '","title":"Esquema principal"}')
