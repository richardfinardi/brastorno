(function(){
"use strict";
var API="https://brastorno.consultoriarf.net";
var $=function(id){return document.getElementById(id)};
var convite=new URLSearchParams(location.search).get("acesso")||"";
var sessao="",nome="",empresa=0,funcionarios=[],produtos=[],rascunhos={};
var pagina=1,limite=50,total=0,debounce=null,modalCodigo=null,modalReservado=false,busy=false;
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function fmt(v){return Number(v||0).toLocaleString("pt-BR",{maximumFractionDigits:4})}
function erroMsg(e){return (e&&e.message)||String(e)}
function aviso(msg,erro){$("mensagem").textContent=msg||"";$("mensagem").className="aviso"+(erro?" erro":"")}
function entradaErro(msg){
 var p=$("erroEntrada");if(!p){p=document.createElement("p");p.id="erroEntrada";$("telaEntrada").appendChild(p)}
 p.textContent=msg;p.className="aviso erro";
}
async function api(path,method,body){
 var cfg={method:method||"GET",headers:{Accept:"application/json"},cache:"no-store"};
 if(body!==undefined){cfg.headers["Content-Type"]="application/json";cfg.body=JSON.stringify(body)}
 var r=await fetch(API+path,cfg),d=null;
 try{d=await r.json()}catch(e){}
 if(!r.ok){
  var detail=d&&d.detail;
  var msg=typeof detail==="string"?detail:Array.isArray(detail)?
     detail.map(function(x){return x.msg||"Dado invalido"}).join(" | "):"Erro HTTP "+r.status;
  if(r.status===401&&sessao)msg+=" Volte a selecao de nome e entre novamente.";
  var err=Error(msg);err.http=r.status;throw err;
 }
 return d;
}
function lbl(f){
 var detalhe=[f.setor,f.cargo].filter(Boolean).join(" / ");
 return f.nome+(detalhe?" | "+detalhe:"");
}
function popularNomes(){
 var busca=$("buscarNome").value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
 var antes=$("selecionarNome").value;
 $("selecionarNome").innerHTML="<option value=''>Selecione seu nome...</option>";
 var lista=funcionarios.filter(function(f){
  return !busca||lbl(f).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().includes(busca);
 });
 lista.forEach(function(f){
  var opt=document.createElement("option");opt.value=f.chave;opt.textContent=lbl(f);$("selecionarNome").add(opt)
 });
 if(lista.some(function(f){return f.chave===antes}))$("selecionarNome").value=antes;
 $("btnIniciar").disabled=!$("selecionarNome").value;
}
async function iniciarTela(){
 if(!convite){entradaErro("Abra o link de contagem fornecido pelo gestor.");return}
 try{
  var d=await api("/brastorno/inventario/publico/funcionarios?convite="+encodeURIComponent(convite));
  empresa=d.cod_empresa;
  $("empresaConvite").textContent="Empresa "+empresa+" | Deposito 1";
  $("empresaConvite").hidden=false;
  funcionarios=d.funcionarios||[];
  popularNomes();
  if(!funcionarios.length)entradaErro("Nenhum funcionario possui materiais atribuidos nesta empresa. Solicite ao gestor uma distribuicao.");
 }catch(e){entradaErro(erroMsg(e))}
}
async function entrar(){
 var chave=$("selecionarNome").value;
 if(!chave){entradaErro("Selecione seu nome.");return}
 $("btnIniciar").disabled=true;
 try{
  var d=await api("/brastorno/inventario/publico/iniciar","POST",{convite:convite,funcionario:chave});
  sessao=d.sessao;empresa=d.cod_empresa;nome=d.nome;pagina=1;rascunhos={};
  $("telaEntrada").hidden=true;$("telaContagem").hidden=false;$("rodape").hidden=false;
  $("nomeContador").innerHTML="<span>"+esc(nome)+" | Empresa "+empresa+"</span>"+
    "<button type='button' id='btnTrocarNome'>Trocar nome</button>";
  $("btnTrocarNome").onclick=trocar;
  atualizarRascunho();
  await carregar();
 }catch(e){entradaErro(erroMsg(e))}
 finally{$("btnIniciar").disabled=false}
}
function atualizarRascunho(){
 var n=Object.keys(rascunhos).length;
 $("resumoRascunho").textContent=n+" material(is) contado(s) ainda nao enviado(s)";
 $("btnEnviar").disabled=n===0||busy;
}
async function carregar(){
 if(!sessao)return;
 $("listaMateriais").innerHTML="<div class='empty'>Buscando os seus materiais...</div>";
 $("paginacao").innerHTML="";
 try{
  var busca=$("buscaMaterial").value.trim();
  var d=await api("/brastorno/inventario/publico/itens?sessao="+encodeURIComponent(sessao)+
   "&pagina="+pagina+"&limite="+limite+"&busca="+encodeURIComponent(busca));
  produtos=d.produtos||[];total=d.total||0;
  $("resumoMateriais").textContent=fmt(total)+" material(is) atribuido(s) | Pagina "+pagina+
    (d.bloqueados_por_colegas_na_pagina?" | "+d.bloqueados_por_colegas_na_pagina+" em contagem por colega":"");
  if(!produtos.length){$("listaMateriais").innerHTML="<div class='empty'>"+
    (total?"Nao ha materiais disponiveis nesta pagina. Atualize ou altere a pesquisa.":"Nenhum material pendente de contagem para este funcionario.")+
    "</div>";}
  else{
   $("listaMateriais").innerHTML=produtos.map(function(p){
    var cod=p.cod_produto,draft=rascunhos[cod],local=p.local_estoque||p.u_localizacao||p.localizacao_estoque||"Sem local informado";
    var label=p.codigo_interno||("#"+cod);
    return "<article class='material'>"+
      "<div class='codigo'>"+esc(label)+"</div><h3>"+esc(p.produto)+"</h3>"+
      "<div class='meta'><strong>UNIDADE:</strong> "+esc(p.unidade||"")+"<br><strong>LOCAL:</strong> "+esc(local)+"</div>"+
      "<div class='acoes'><span class='estado'>"+(draft?"Contado: "+fmt(draft.qtde_inventariada):"Aguardando contagem")+"</span>"+
      "<button type='button' class='"+(draft?"":"primario")+"' onclick='BRPubContar("+cod+")'>"+(draft?"Alterar":"Contar")+"</button></div></article>";
   }).join("");
  }
  $("paginacao").innerHTML="<span>Pagina "+pagina+"</span>"+
    "<button type='button' "+(pagina<=1?"disabled":"")+" onclick='BRPubPagina(-1)'>Anterior</button>"+
    "<button type='button' "+(!d.tem_mais?"disabled":"")+" onclick='BRPubPagina(1)'>Proxima</button>";
 }catch(e){
  $("listaMateriais").innerHTML="<div class='empty'>Nao foi possivel carregar os materiais.</div>";
  aviso(erroMsg(e),true);
 }
}
function formLote(nome,qtd){
 return "<div class='lote-linha'><input class='lote-nome' placeholder='Identificacao do lote' value='"+esc(nome||"")+"' maxlength='255'>"+
  "<input class='lote-qtde' inputmode='decimal' type='number' step='any' min='0' placeholder='Quantidade' value='"+esc(qtd==null?"":qtd)+"'></div>";
}
async function contar(cod){
 if(busy)return;
 var p=produtos.find(function(x){return Number(x.cod_produto)===Number(cod)});
 if(!p)return;
 modalCodigo=cod;modalReservado=false;
 try{
  await api("/brastorno/inventario/publico/reservar","POST",{sessao:sessao,cod_produto:cod});
  modalReservado=true;
 }catch(e){aviso("Nao foi possivel iniciar a contagem deste material: "+erroMsg(e),true);return}
 var lote=[1,2,3].includes(Number(p.tipo_controle)),draft=rascunhos[cod];
 var html="<div class='modal-dialog'><h2>"+esc(p.codigo_interno||cod)+"</h2><p class='sub'>"+esc(p.produto)+"</p>"+
  "<p class='sub'>Informe a quantidade fisica. Nao consulte o saldo do CPS.</p>";
 if(lote){
  html+="<label>Lotes / series</label><div id='listaLotes'>";
  var ls=draft&&draft.lotes?draft.lotes:(p.lotes||[]);
  ls.forEach(function(x){html+=formLote(x.nome,draft?x.qtde:"")});
  html+="</div><button type='button' id='adicionarLote'>+ Novo lote</button>";
 }else{
  html+="<label for='qtdContada'>Quantidade contada ("+esc(p.unidade||"")+")</label>"+
    "<input id='qtdContada' type='number' inputmode='decimal' step='any' min='0' placeholder='Informe a quantidade' value='"+
    esc(draft?draft.qtde_inventariada:"")+"' autocomplete='off'>";
 }
 html+="<p id='erroModal' class='aviso erro' hidden></p><div class='buttons'>"+
  "<button type='button' id='cancelarModal'>Cancelar</button><button type='button' class='primario' id='salvarModal'>Salvar contagem</button></div></div>";
 $("modal").innerHTML=html;$("modal").hidden=false;
 $("cancelarModal").onclick=cancelarModal;
 $("salvarModal").onclick=salvarModal;
 var novo=$("adicionarLote");if(novo)novo.onclick=function(){$("listaLotes").insertAdjacentHTML("beforeend",formLote("",""))};
 var qtd=$("qtdContada");if(qtd)qtd.focus();
}
async function cancelarModal(){
 $("modal").hidden=true;
 if(modalReservado&&!rascunhos[modalCodigo]){
  try{await api("/brastorno/inventario/publico/liberar","POST",{sessao:sessao,cod_produto:modalCodigo})}catch(e){}
 }
 modalCodigo=null;modalReservado=false;
}
function errModal(msg){$("erroModal").hidden=false;$("erroModal").textContent=msg}
function salvarModal(){
 var cod=modalCodigo;if(!cod)return;
 var p=produtos.find(function(x){return Number(x.cod_produto)===Number(cod)});
 if(!p)return;
 var lote=[1,2,3].includes(Number(p.tipo_controle)),qtde=0,lotes=null;
 if(lote){
  lotes=[];var seen={};
  for(var row of document.querySelectorAll(".lote-linha")){
   var nome=row.querySelector(".lote-nome").value.trim(),val=row.querySelector(".lote-qtde").value.trim(),v=Number(val);
   if(!nome||!val||!Number.isFinite(v)||v<0){errModal("Preencha todos os lotes com quantidades validas, inclusive zero.");return}
   if(seen[nome.toUpperCase()]){errModal("Lote repetido.");return}
   seen[nome.toUpperCase()]=true;lotes.push({nome:nome,qtde:v});qtde+=v;
  }
  if(!lotes.length){errModal("Informe pelo menos um lote.");return}
 }else{
  var texto=$("qtdContada").value.trim();
  if(texto===""||!Number.isFinite(Number(texto))||Number(texto)<0){errModal("Informe quantidade maior ou igual a zero.");return}
  qtde=Number(texto);
 }
 rascunhos[cod]={cod_produto:cod,qtde_inventariada:qtde,lotes:lotes};
 $("modal").hidden=true;modalCodigo=null;modalReservado=false;
 atualizarRascunho();carregar();aviso("Contagem registrada. Envie as contagens para conferencia.");
}
async function enviar(){
 var todos=Object.values(rascunhos);
 if(!todos.length||busy)return;
 if(todos.length>100){aviso("Envie no maximo 100 materiais por vez.",true);return}
 if(!confirm("Enviar "+todos.length+" material(is) para conferencia? Eles desaparecerao da sua lista."))return;
 busy=true;atualizarRascunho();
 try{
  var res=await api("/brastorno/inventario/publico/contagens","POST",{sessao:sessao,itens:todos});
  rascunhos={};
  pagina=1;
  atualizarRascunho();await carregar();
  aviso(res.quantidade+" material(is) enviado(s) para conferencia. Nao e necessario contar novamente.");
 }catch(e){aviso(erroMsg(e),true)}
 finally{busy=false;atualizarRascunho()}
}
function trocar(){
 if(!confirm("Trocar o funcionario? Contagens nao enviadas serao descartadas."))return;
 Object.keys(rascunhos).forEach(function(cod){
  api("/brastorno/inventario/publico/liberar","POST",{sessao:sessao,cod_produto:Number(cod)}).catch(function(){});
 });
 sessao="";rascunhos={};produtos=[];nome="";
 $("telaContagem").hidden=true;$("telaEntrada").hidden=false;$("rodape").hidden=true;
 $("buscarNome").value="";$("selecionarNome").value="";popularNomes();
}
window.BRPubContar=contar;
window.BRPubPagina=function(delta){pagina=Math.max(1,pagina+delta);carregar();window.scrollTo({top:0,behavior:"smooth"})};
$("btnIniciar").onclick=entrar;$("btnEnviar").onclick=enviar;
$("btnAtualizar").onclick=carregar;
$("selecionarNome").onchange=function(){$("btnIniciar").disabled=!this.value};
$("buscarNome").oninput=popularNomes;
$("buscaMaterial").oninput=function(){clearTimeout(debounce);debounce=setTimeout(function(){pagina=1;carregar()},350)};
iniciarTela();
})();