(function(){
"use strict";
var API="https://brastorno.consultoriarf.net";
var TOKEN=localStorage.getItem("brastorno_token");
if(!TOKEN){location.replace("../login.html");return;}
var perfil=null,aba="contagem",empresa=Number(localStorage.getItem("br_invent_empresa")||1),pagina=1,limite=75;
var itens=[],rascunhos={},temporizador=null,cabecalhoConsulta=null;
var camposFiltros=["familia","grupo","subgrupo1","subgrupo2","subgrupo3","subgrupo4","subgrupo5","subgrupo6","subgrupo7","local_estoque","local_parte1","local_parte2"];
var filtrosAtivos={};var consultaSerial=0;
// Origem do material: metodo_reposicao 0 = Compras, 1 = Producao propria.
// Metodo 2 permanece no filtro Todos ate confirmacao do seu significado.
var metodoReposicao=localStorage.getItem("br_inv_metodo_reposicao")||"";
if(!["","0","1"].includes(metodoReposicao))metodoReposicao="";
var equipes=[],usuariosInventario=[];
var selecaoRecontagem=new Set();
var contagensRecontagem=[];
var consultaFiltrosSerial=0;var consultaAtribSerial=0;var selecaoAtrib=new Set(),listaAtribAtual=[];
var $=function(id){return document.getElementById(id)};
function esc(s){return String(s===null||s===undefined?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function puro(v){return String(v===null||v===undefined?"":v).normalize("NFD").replace(/[\u0300-\u036f]/g,"")}
function num(v){return Number(String(v===null||v===undefined?0:v).replace(",","."))||0}
function fmt(v){return num(v).toLocaleString("pt-BR",{maximumFractionDigits:4})}
function moeda(v){return num(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
function aviso(s,erro){$("aviso").textContent=s;$("aviso").className="aviso"+(erro?" erro":"")}
function erroMsg(e){return (e&&e.message)||String(e)}
async function api(caminho,metodo,body){
 var t=localStorage.getItem("brastorno_token");
 if(!t){location.href="../login.html";throw Error("Sessao encerrada.")}
 var opt={method:metodo||"GET",headers:{"Authorization":"Bearer "+t,"Accept":"application/json"},cache:"no-store"};
 if(body!==undefined){opt.headers["Content-Type"]="application/json";opt.body=JSON.stringify(body)}
 var r=await fetch(API+caminho,opt),val=null;
 try{val=await r.json()}catch(e){}
 if(r.status===401){localStorage.removeItem("brastorno_token");location.href="../login.html";throw Error("Sessao expirada.")}
 if(!r.ok){
  var d=val&&val.detail;
  var mensagem=typeof d==="string"?d:(Array.isArray(d)?
   d.map(function(x){return (x.loc?x.loc.slice(1).join(".")+": ":"")+(x.msg||"Entrada invalida")}).join(" | "):
   (d&&d.message)||((val&&val.message)||"Erro HTTP "+r.status));
  var erro=Error(mensagem);erro.http=r.status;erro.detail=d;throw erro;
 }
 return val;
}
function isGestor(){return perfil&&perfil.inventario_gestor}
function trocarAba(id){
 if(id!=="contagem"&&!isGestor())return;
 aba=id;pagina=1;localStorage.setItem("br_invent_aba",id);
 document.querySelectorAll("[data-aba]").forEach(function(x){x.classList.toggle("ativa",x.getAttribute("data-aba")===id)});
 $("lista").hidden=(id==="parametrizacoes"||id==="conferencia");
 $("paginacao").hidden=(id==="parametrizacoes"||id==="conferencia");
 $("acaoContagem").hidden=(id!=="contagem");
 ["reservados","contagem","parametrizacoes","conferencia"].forEach(function(x){$(x).hidden=x!==id});
 $("tituloAba").textContent=({"reservados":"Itens reservados","contagem":"Contagem","parametrizacoes":"Parametrizacoes","conferencia":"Conferencia"})[id];
 $("filtros").hidden=false; // Filtros disponiveis nas quatro abas
 $("blocoFiltroOrigem").hidden=(id==="parametrizacoes");
 $("exportarInventario").hidden=(id!=="reservados");
 aviso("");
 if(id==="parametrizacoes"){carregarConfig();carregarEquipes();carregarFiltros("dist");}
 else if(id==="conferencia"){carregarDestinosRecontagem();carregarConferencia()}
 else carregarItens();
 carregarFiltros("main");
}
function setEmpresa(v){
 empresa=Number(v)||1;pagina=1;rascunhos={};filtrosAtivos={};filtrosDist={};
 localStorage.setItem("br_invent_empresa",empresa);
 camposFiltros.forEach(function(k){var el=$("filtro_"+k);if(el)el.value=""});
 trocarAba(aba)
}
var filtrosDist={},serieFiltrosDist=0;
function queryFiltros(escopo,selecionados){
 var modo=escopo==="dist"?"parametrizacoes":aba;
 var q="/brastorno/inventario/filtros?cod_empresa="+empresa+"&modo="+modo;
 if(escopo==="main"&&aba!=="parametrizacoes"&&metodoReposicao!=="")
   q+="&metodo_reposicao="+metodoReposicao;
 if(escopo==="main")q+="&busca="+encodeURIComponent($("pesquisa").value.trim());
 camposFiltros.forEach(function(k){
  if(selecionados[k])q+="&"+k+"="+encodeURIComponent(selecionados[k]);
 });
 return q;
}
function limparDescendentes(campo,selecionados,prefixo){
 // Trocar familia limpa grupo e subgrupos posteriores. O local permanece
 // como filtro independente e tambem restringe as demais opcoes.
 var idx=camposFiltros.indexOf(campo);
 if(idx<0||campo.startsWith("local_"))return;
 for(var i=idx+1;i<camposFiltros.indexOf("local_estoque");i++){
  selecionados[camposFiltros[i]]="";
  var el=$(prefixo+camposFiltros[i]);if(el)el.value="";
 }
}
async function carregarFiltros(escopo,tentativa){
 escopo=escopo||"main";
 var dist=escopo==="dist";
 var eAtual=empresa;
 var serial=dist?++serieFiltrosDist:++consultaFiltrosSerial;
 var selecionados=dist?filtrosDist:filtrosAtivos;
 var msg=dist?null:$("msgFiltros");
 if(msg)msg.textContent="Atualizando opcoes incrementais...";
 try{
  var resposta=await api(queryFiltros(escopo,selecionados));
  if(eAtual!==empresa||serial!==(dist?serieFiltrosDist:consultaFiltrosSerial))return;
  var selecionadoInvalido=false;
  camposFiltros.forEach(function(k){
   var el=$((dist?"dist_":"filtro_")+k);
   if(!el)return;
   var atual=String(selecionados[k]||"");
   var opcoes=(resposta.filtros&&resposta.filtros[k])||[];
   var frag=document.createDocumentFragment();
   var todos=document.createElement("option");todos.value="";todos.textContent="Todos";frag.appendChild(todos);
   opcoes.forEach(function(v){
    var opt=document.createElement("option");opt.value=v;opt.textContent=v==="__SEM_LOCAL__"?"Sem local de estoque":puro(v);frag.appendChild(opt);
   });
   el.replaceChildren(frag);
   if(atual&&opcoes.indexOf(atual)<0){
    selecionados[k]="";
    selecionadoInvalido=true;
   }
   el.value=selecionados[k]||"";
  });
  if(msg)msg.textContent="As opcoes acompanham os filtros selecionados.";
  if(selecionadoInvalido && !tentativa){
   if(!dist){
    var ativos=camposFiltros.filter(function(k){return !!filtrosAtivos[k]}).length;
    $("btnFiltro").textContent="Filtros"+(ativos?" ("+ativos+")":"");
    recarregarAba();
   }
   return carregarFiltros(escopo,true);
  }
 }catch(err){
  if(serial===(dist?serieFiltrosDist:consultaFiltrosSerial)){
   if(msg)msg.textContent="Erro nos filtros: "+erroMsg(err);
   else aviso("Filtros da distribuicao: "+erroMsg(err),true);
  }
 }
}
function aplicarFiltro(campo){
 camposFiltros.forEach(function(k){var x=$("filtro_"+k);filtrosAtivos[k]=x?x.value:""});
 limparDescendentes(campo,filtrosAtivos,"filtro_");
 var usados=camposFiltros.filter(function(k){return !!filtrosAtivos[k]}).length;
 $("btnFiltro").textContent="Filtros"+(usados?" ("+usados+")":"");
 pagina=1;
 recarregarAba();
 carregarFiltros("main");
}
function aplicarFiltroDist(campo){
 camposFiltros.forEach(function(k){var x=$("dist_"+k);filtrosDist[k]=x?x.value:""});
 limparDescendentes(campo,filtrosDist,"dist_");
 carregarFiltros("dist");
}
function filtrarMetodoReposicao(){
 metodoReposicao=$("filtroMetodoReposicao").value;
 localStorage.setItem("br_inv_metodo_reposicao",metodoReposicao);
 pagina=1;
 recarregarAba();
 carregarFiltros("main");
}
function limparFiltros(){
 metodoReposicao="";
 $("filtroMetodoReposicao").value="";
 localStorage.removeItem("br_inv_metodo_reposicao");
 filtrosAtivos={};camposFiltros.forEach(function(k){var x=$("filtro_"+k);if(x)x.value=""});
 $("btnFiltro").textContent="Filtros";
 pagina=1;recarregarAba();carregarFiltros("main");
}
function recarregarAba(){
 if(aba==="conferencia")carregarConferencia();
 else if(aba==="parametrizacoes")carregarAtribuicoes();
 else carregarItens();
}
function parametrosFiltros(){
 var q="&busca="+encodeURIComponent($("pesquisa").value.trim());
 if(aba!=="parametrizacoes"&&metodoReposicao!=="")q+="&metodo_reposicao="+metodoReposicao;
 camposFiltros.forEach(function(k){if(filtrosAtivos[k])q+="&"+k+"="+encodeURIComponent(filtrosAtivos[k])});
 return q;
}
function togglePainelFiltros(){
 $("painelFiltros").hidden=!$("painelFiltros").hidden;
 $("btnFiltro").setAttribute("aria-expanded",String(!$("painelFiltros").hidden));
}

async function carregarItens(){
 var atual=aba;
 $("lista").innerHTML="<div class='carregando'>Carregando materiais...</div>";
 $("paginacao").innerHTML="";
 try{
  var serial=++consultaSerial;
  var q="/brastorno/inventario/itens?cod_empresa="+empresa+"&pagina="+pagina+"&limite="+limite+
   "&modo="+(aba==="reservados"?"reservados":"contagem")+parametrosFiltros();
  var d=await api(q);
  if(atual!==aba||serial!==consultaSerial)return;
  itens=d.produtos||[];cabecalhoConsulta=d;
  $("resumo").textContent=fmt(d.total)+" materiais | Empresa "+empresa+" | Deposito 1";
 $("resumoContagem").textContent=fmt(d.total)+" materiais | Empresa "+empresa+" | Deposito 1";
  if(aba==="reservados")montarReservados();
  else {
    montarContagem();
    $("resumoContagem").textContent=fmt(d.total)+" material(is) atribuido(s) a voce | Deposito 1";
  }
  $("exportarInventario").hidden=(aba==="contagem");
  $("paginacao").innerHTML="<span>Pagina "+pagina+" | "+fmt(d.total)+" registros</span>"+
   "<button "+(pagina<=1?"disabled":"")+" onclick='BRPagina(-1)'>Anterior</button>"+
   "<button "+(!d.tem_mais?"disabled":"")+" onclick='BRPagina(1)'>Proxima</button>";
 }catch(e){$("lista").innerHTML="<div class='erro-caixa'>"+esc(erroMsg(e))+"</div>";aviso(erroMsg(e),true)}
}
function local(p){
 var a=String(p.u_localizacao||"").trim(),b=String(p.localizacao_estoque||"").trim();
 return (a&&b&&a!==b)?a+" / "+b:(a||b||"");
}
function subgrupos(p){
 var partes=[];for(var i=1;i<=7;i++){var v=p["subgrupo"+i];if(v)partes.push("<small><b>"+i+":</b> "+esc(v)+"</small>")}
 return partes.join("")||"";
}
function rowsBase(p){return "<td><b>"+esc(p.codigo_interno||p.cod_produto)+"</b><small>#"+esc(p.cod_produto)+"</small></td>"+
 "<td class='produto'>"+esc(p.produto)+"</td><td>"+esc(p.familia||"")+"</td><td>"+esc(p.grupo||"")+"</td>"+
 "<td class='subgrupos'>"+subgrupos(p)+"</td><td>"+esc(p.unidade||"")+"</td><td>"+esc(local(p))+"</td>";
}
function osChips(p){
 var rr=p.reservas_os||[];
 if(num(p.qtde_reservada)<=0)return ""; if(!rr.length)return "<span class='chip alerta'>Reserva registrada, sem OS identificada</span>";
 return rr.map(function(r){return "<span class='chip'>"+(r.n_os?"OS "+esc(r.n_os):"OS nao identificada")+
  " | "+fmt(r.qtde)+(r.descricao?" | "+esc(r.descricao):"")+"</span>"}).join("");
}
function montarReservados(){
 $("acaoContagem").hidden=true;
 itens=itens.filter(function(p){return num(p.qtde_reservada)>0});
 var out="<div class='tabela'><table><thead><tr><th>Codigo</th><th>Material</th><th>Familia</th><th>Grupo</th><th>Subgrupos 1 a 7</th><th>Unid.</th><th>Local de estoque</th><th>Saldo CPS</th><th>Reservado</th><th>OS / Origem da reserva</th><th>Solicitada reservada</th></tr></thead><tbody>";
 itens.forEach(function(p){out+="<tr>"+rowsBase(p)+"<td class='direita'>"+fmt(p.qtde_total)+"</td>"+
  "<td class='direita'>"+fmt(p.qtde_reservada)+"</td><td>"+osChips(p)+"</td><td class='direita'>"+fmt(p.qtde_solicitada_reservada)+"</td></tr>"});
 $("lista").innerHTML=out+(itens.length?"":"<tr><td colspan='11'>Nenhuma reserva localizada.</td></tr>")+"</tbody></table></div>";
}
function mudaQuantidade(cod,v){
 if(v===""){delete rascunhos[cod];atualizaSelecionados();return}
 var n=Number(v);
 if(!Number.isFinite(n)||n<0){aviso("Informe quantidade valida.",true);return}
 rascunhos[cod]={qtde:n,lotes:null};atualizaSelecionados();
}
function atualizaSelecionados(){
 var c=Object.keys(rascunhos).length;
 $("quantidadeDigitada").textContent=c+" contagem(ns) preenchida(s) - enviar itens desta pagina";
}
function montarContagem(){
 $("acaoContagem").hidden=false;
 // Contagem cega: SEM saldo CPS, reservado, familia/grupo/subgrupos ou custo.
 // As classificacoes permanecem disponiveis APENAS nos filtros.
 var out="<div class='tabela contagem-wrap'><table class='contagem-tabela'>"+
  "<thead><tr><th>Codigo</th><th>Material</th><th>Unid.</th><th>Local de estoque</th><th>Contagem fisica</th><th>Lotes / Series</th></tr></thead><tbody>";
 itens.forEach(function(p){
  var cod=p.cod_produto,lote=[1,2,3].includes(Number(p.tipo_controle)),d=rascunhos[cod];
  var localTexto=local(p), nome=p.codigo_interno||p.cod_produto;
  out+="<tr class='contagem-linha'>"+
   "<td class='contagem-codigo'><strong>"+esc(nome)+"</strong><small>#"+esc(p.cod_produto)+"</small></td>"+
   "<td class='contagem-material'>"+esc(p.produto||"")+"</td>"+
   "<td class='contagem-unidade'>"+esc(p.unidade||"")+"</td>"+
   "<td class='contagem-local'>"+(localTexto?esc(localTexto):"<span class='sem-local'>Sem local informado</span>")+"</td>"+
   "<td class='contagem-input'>"+(lote?
      "<span class='contagem-valor'>"+(d?fmt(d.qtde):"Nao contada")+"</span>":
      "<input class='qtd' type='number' inputmode='decimal' step='any' min='0' placeholder='Contar...' value='"+(d?esc(d.qtde):"")+
      "' oninput='BRQtd("+cod+",this.value)' autocomplete='off' aria-label='Quantidade contada do material "+esc(nome)+"'>")+
   "</td>"+
   "<td class='contagem-lotes'>"+(lote?"<button class='mini' onclick='BRLotes("+cod+")'>Contar lotes</button>":"")+"</td></tr>";
 });
 $("lista").innerHTML=out+(itens.length?"":"<tr><td colspan='6'>Nenhum material atribuido neste filtro.</td></tr>")+
  "</tbody></table></div>";
 atualizaSelecionados();
}
function lotes(cod){
 var p=itens.find(function(x){return Number(x.cod_produto)===Number(cod)});
 if(!p)return;
 var d=rascunhos[cod]||{},lista=d.lotes||p.lotes||[];
 var out="<div class='modal-bloco'><h2>Lotes / Series</h2><p>"+esc(p.codigo_interno)+" | "+esc(p.produto)+"</p>"+
  "<p>Informe a quantidade fisica de cada lote, inclusive zero.</p>"+
  "<div id='linhasLote'>";
 lista.forEach(function(l){out+=linhaLote(l.nome,d.lotes?l.qtde:"")});
 out+="</div><button class='mini' onclick='BRAdicionarLote()'>+ Novo lote</button>"+
  "<div class='modal-botoes'><button onclick='BRFecharModal()'>Cancelar</button><button class='destaque' onclick='BRSalvarLotes("+cod+")'>Salvar contagem</button></div></div>";
 $("modal").innerHTML=out;$("modal").hidden=false;
}
function linhaLote(nome,qtd){return "<div class='linha-lote'><input class='nome-lote' placeholder='Lote / Serie' value='"+esc(nome)+"'>"+
 "<input class='qtd-lote' type='number' min='0' step='any' placeholder='Contagem...' value='"+esc(qtd===null||qtd===undefined?"":qtd)+"' autocomplete='off'></div>"}
function adicionarLote(){$("linhasLote").insertAdjacentHTML("beforeend",linhaLote("",""))}
function salvarLotes(cod){
 var rows=Array.from(document.querySelectorAll(".linha-lote")),ls=[],vistos={};
 for(var i=0;i<rows.length;i++){
  var nome=rows[i].querySelector(".nome-lote").value.trim(),textoQtd=rows[i].querySelector(".qtd-lote").value;
  var q=Number(textoQtd);
  if(!nome||textoQtd.trim()===""||!Number.isFinite(q)||q<0){aviso("Lote e quantidade invalidos.",true);return}
  if(vistos[nome.toUpperCase()]){aviso("Lote repetido.",true);return}
  vistos[nome.toUpperCase()]=1;ls.push({nome:nome,qtde:q});
 }
 if(!ls.length){aviso("Informe ao menos um lote.",true);return}
 rascunhos[cod]={qtde:ls.reduce(function(a,x){return a+x.qtde},0),lotes:ls};
 $("modal").hidden=true;montarContagem();aviso("Lotes registrados na contagem.");
}
async function enviarContagens(){
 var selecionados=itens.filter(function(p){return Object.prototype.hasOwnProperty.call(rascunhos,p.cod_produto)});
 if(!selecionados.length){aviso("Informe ao menos uma contagem na pagina.",true);return}
 var payload={cod_empresa:empresa,itens:selecionados.map(function(p){
  var d=rascunhos[p.cod_produto];
  return {cod_produto:p.cod_produto,qtde_inventariada:d.qtde,versao:p.versao,lotes:d.lotes};
 })};
 if(!confirm("Enviar "+payload.itens.length+" contagem(ns) para conferencia? O estoque nao sera alterado agora."))return;
 try{
  $("btnEnviar").disabled=true;
  var r=await api("/brastorno/inventario/contagens","POST",payload);
  selecionados.forEach(function(p){delete rascunhos[p.cod_produto]});
  aviso(r.quantidade+" contagem(ns) enviadas para conferencia.");
  await carregarItens();
 }catch(e){aviso(erroMsg(e),true)}
 finally{$("btnEnviar").disabled=false}
}
async function carregarConfig(){
 $("formConfig").innerHTML="<p>Carregando configuracoes...</p>";
 try{
  var c=await api("/brastorno/inventario/config?cod_empresa="+empresa);
  $("formConfig").innerHTML="<label class='check'><input id='cfgAtivos' type='checkbox' "+(c.somente_ativos?"checked":"")+"> Somente materiais ativos</label>"+
   "<label class='check'><input id='cfgMetodo' type='checkbox' "+(c.metodo_zero?"checked":"")+"> Somente metodo de reposicao 0</label>"+
   "<p>Desmarque o segundo filtro para incluir todos os metodos, inclusive produtos acabados.</p>"+
   "<button class='destaque' onclick='BRGravarConfig()'>Salvar parametrizacoes</button>";
 }catch(e){$("formConfig").textContent=erroMsg(e)}
}
async function gravarConfig(){
 try{
  await api("/brastorno/inventario/config","POST",{cod_empresa:empresa,somente_ativos:$("cfgAtivos").checked,metodo_zero:$("cfgMetodo").checked});
  carregarFiltros("main");carregarFiltros("dist");aviso("Parametrizacoes salvas para empresa "+empresa+".");
 }catch(e){aviso(erroMsg(e),true)}
}
async function carregarConferencia(){
 selecaoRecontagem.clear();contagensRecontagem=[];atualizarSelecaoRecontagem();
 $("listaConferencia").innerHTML="<p>Carregando contagens...</p>";
 try{
  var status=$("statusConferencia").value;
  var d=await api("/brastorno/inventario/contagens?cod_empresa="+empresa+"&status="+status+"&pagina=1&limite=250"+parametrosFiltros());
  var todas=d.contagens||[];
  contagensRecontagem=todas;
  var bloqueados=todas.filter(function(r){return r.status==="PENDENTE"&&r.segregado_reserva});
  var regulares=todas.filter(function(r){return !(r.status==="PENDENTE"&&r.segregado_reserva)});
  function tabela(rows){
   var out="<div class='tabela'><table><thead><tr><th>Selecionar</th><th>Data</th><th>Material</th><th>Contador</th><th>Unid.</th><th>Saldo CPS</th><th>Reservado</th><th>Contado</th><th>Diferenca</th><th>Tolerancia</th><th>Impacto custo</th><th>Status</th><th>Acao</th></tr></thead><tbody>";
   rows.forEach(function(r){
    var i=(r.payload&&r.payload.itens||[])[0]||{};
    var qtd=num(i.qtde_inventariada),saldo=num(i.estoque_esperado),dif=qtd-saldo;
    var unidadeExibida=String(r.unidade||i.unidade_contagem||i.unidade||"").trim().toUpperCase();
    var abaixo=r.status==="PENDENTE"&&r.segregado_reserva;
    var tolerancia=r.tolerancia_percentual;
    var percentual=r.desvio_percentual;
    var tolText=(tolerancia===null||tolerancia===undefined?"Nao configurada":("±"+fmt(tolerancia)+"%"))+
      (percentual===null||percentual===undefined?"":(" | Desvio "+fmt(percentual)+"%"));
    var estiloTol=r.dentro_tolerancia?"ok-tolerancia":"fora-tolerancia";
    out+="<tr class='"+(abaixo?"linha-bloqueada":"")+"'>"+
      "<td>"+(["PENDENTE","APLICADA"].includes(r.status)?
      "<input type='checkbox' data-recontagem='"+esc(r.id)+"' onchange='BRMarcarRecontagem(\""+esc(r.id)+"\",this.checked)' aria-label='Selecionar para recontagem'>":"")+"</td>"+
      "<td>"+esc(r.criada_em)+"</td>"+
      "<td><b>"+esc(r.codigo_interno||("#"+r.cod_produto))+"</b><small>"+esc(r.produto)+"</small></td>"+
       "<td>"+esc(r.usuario)+"</td><td>"+esc(unidadeExibida||"—")+"</td>"+
      "<td class='direita'>"+fmt(saldo)+"</td><td class='direita'>"+fmt(r.qtde_reservada_atual)+"</td>"+
      "<td class='direita'>"+fmt(qtd)+"</td><td class='direita "+(dif<0?"negativo":"")+"'>"+fmt(dif)+"</td>"+
      "<td class='"+estiloTol+"'>"+esc(tolText)+"</td>"+
      "<td class='direita'>"+moeda(dif*num(r.preco_custo))+"</td>"+
      "<td>"+(abaixo?"<span class='tag-bloqueio'>ABAIXO DA RESERVA</span>":esc(r.status))+"</td>"+
      "<td>"+(r.status==="PENDENTE"?(abaixo?
         "<span class='motivo-bloqueio'>Gravacao bloqueada. Encaminhe para outra contagem.</span>"+
         "<button class='mini' onclick='BRRecontarItem(\""+esc(r.id)+"\")'>Solicitar recontagem</button>":
         "<button class='mini destaque' onclick='BRDecidir(\""+esc(r.id)+"\",true)'>Aplicar no CPS</button>"+
         "<button class='mini' onclick='BRDecidir(\""+esc(r.id)+"\",false)'>Rejeitar</button>"+
         "<button class='mini' onclick='BRRecontarItem(\""+esc(r.id)+"\")'>Recontar</button>"):
        (r.status==="APLICADA"?"<button class='mini' onclick='BRRecontarItem(\""+esc(r.id)+"\")'>Recontar</button>":""))+"</td></tr>";
   });
   return out+(rows.length?"":"<tr><td colspan='13'>Nenhuma contagem.</td></tr>")+"</tbody></table></div>";
  }
  var html="<div class='segregacao-bloco'><div class='segregacao-titulo'><strong>ABAIXO DA QUANTIDADE RESERVADA</strong><span class='tag-bloqueio'>"+bloqueados.length+" item(ns)</span></div>"+
    "<p class='alerta-reserva'>Estes itens estao separados e nao podem ajustar o estoque enquanto a reserva real no CPS superar a contagem.</p>"+
    tabela(bloqueados)+"</div>"+
    "<div class='segregacao-bloco'><div class='segregacao-titulo'><strong>DEMAIS CONTAGENS</strong><span>"+regulares.length+" item(ns)</span></div>"+
    tabela(regulares)+"</div>"+
    "<p class='info-suave'>"+fmt(d.total)+" contagem(ns). Exibindo ate 250 por consulta.</p>";
  $("listaConferencia").innerHTML=html;
  atualizarSelecaoRecontagem();
 }catch(e){$("listaConferencia").innerHTML="<div class='erro-caixa'>"+esc(erroMsg(e))+"</div>";aviso(erroMsg(e),true)}
}
function atualizarSelecaoRecontagem(){
 $("contadorRecontagem").textContent=selecaoRecontagem.size+" item(ns) selecionado(s)";
 $("btnSolicitarRecontagem").disabled=selecaoRecontagem.size===0;
}
function marcarRecontagem(id,marcado){
 if(marcado)selecaoRecontagem.add(id);
 else selecaoRecontagem.delete(id);
 atualizarSelecaoRecontagem();
}
function selecionarTodasRecontagens(){
 document.querySelectorAll("[data-recontagem]").forEach(function(el){
  if(!el.checked){el.checked=true;selecaoRecontagem.add(el.getAttribute("data-recontagem"))}
 });
 atualizarSelecaoRecontagem();
}
function limparRecontagem(){
 selecaoRecontagem.clear();
 document.querySelectorAll("[data-recontagem]").forEach(function(el){el.checked=false});
 atualizarSelecaoRecontagem();
}
function recontarItem(id){
 limparRecontagem();
 marcarRecontagem(id,true);
 document.querySelectorAll("[data-recontagem]").forEach(function(el){
  el.checked=el.getAttribute("data-recontagem")===id;
 });
 $("tipoDestinoRecontagem").scrollIntoView({behavior:"smooth",block:"center"});
 $("tipoDestinoRecontagem").focus({preventScroll:true});
}
function erroRecontagem(texto){
 var painel=$("erroRecontagem");
 if(!painel){aviso(texto,true);return}
 painel.textContent=texto||"";
 painel.hidden=!texto;
 if(texto){aviso("Recontagem nao enviada: "+texto,true);painel.scrollIntoView({block:"nearest",behavior:"smooth"})}
}
function destinoRecontagem(){
 erroRecontagem("");
 var pessoa=$("tipoDestinoRecontagem").value==="usuario";
 $("pessoaRecontagemBloco").hidden=!pessoa;
 $("grupoRecontagemBloco").hidden=pessoa;
}
async function carregarDestinosRecontagem(){
 var eAgora=empresa;
 try{
  var [g,u]=await Promise.all([
   api("/brastorno/inventario/grupos?cod_empresa="+empresa),
   api("/brastorno/inventario/usuarios")
  ]);
  if(eAgora!==empresa)return;
  equipes=g.grupos||[];usuariosInventario=u.usuarios||[];
  optionList($("pessoaRecontagem"),usuariosInventario.map(function(x){return {id:x,nome:x}}),"","Selecione um usuario...");
  var destinoAnterior=$("grupoRecontagem").value;
  $("grupoRecontagem").innerHTML="<option value=''>Selecione um grupo...</option>";
  equipes.forEach(function(g){
   var membros=(g.integrantes||[]).length;
   var opt=document.createElement("option");
   opt.value=g.id;opt.textContent=puro(g.nome)+" ("+membros+" integrante"+(membros===1?"":"s")+")";
   opt.disabled=membros===0;
   if(!membros)opt.title="Adicione integrantes em Parametrizacoes";
   $("grupoRecontagem").add(opt);
  });
  if(destinoAnterior)$("grupoRecontagem").value=destinoAnterior;
 }catch(ex){aviso("Destinos de recontagem: "+erroMsg(ex),true)}
}
async function solicitarRecontagem(){
 erroRecontagem("");
 var ids=Array.from(selecaoRecontagem);
 if(ids.length<1||ids.length>100){erroRecontagem("Selecione de 1 a 100 contagens.");return}
 var porPessoa=$("tipoDestinoRecontagem").value==="usuario";
 var destino=porPessoa?$("pessoaRecontagem").value:$("grupoRecontagem").value;
 if(!destino){erroRecontagem("Escolha uma pessoa ou grupo para a recontagem.");return}
 var linhas=ids.map(function(id){return contagensRecontagem.find(function(x){return x.id===id})});
 if(linhas.some(function(x){return !x})){erroRecontagem("Atualize a Conferencia e selecione novamente.");return}
 var grupo=porPessoa?null:equipes.find(function(g){return g.id===destino});
 if(grupo&&!(grupo.integrantes||[]).length){
  erroRecontagem("O grupo "+grupo.nome+" nao tem integrantes. Adicione pessoas em Parametrizacoes antes de usar.");
  return;
 }
 for(var k=0;k<linhas.length;k++){
  var r=linhas[k],cod=r.codigo_interno||r.cod_produto;
  if(!porPessoa&&r.grupo_atribuido_atual&&r.grupo_atribuido_atual===destino){
   erroRecontagem("Material "+cod+": esse e o grupo atual. Selecione OUTRO grupo ou outra pessoa.");
   return;
  }
  if(porPessoa&&(
     String(r.usuario_atribuido_atual||"").toUpperCase()===destino.toUpperCase()||
     String(r.usuario||"").toUpperCase()===destino.toUpperCase())){
   erroRecontagem("Material "+cod+": "+destino+" ja foi responsavel pela contagem. Selecione outra pessoa.");
   return;
  }
 }
 var nomeDestino=porPessoa?destino:(grupo?grupo.nome:destino);
 if(!confirm("Solicitar recontagem de "+ids.length+" material(is) para "+nomeDestino+
  "?\nAs contagens anteriores permanecem no historico; nao altera o estoque CPS."))return;
 var body={cod_empresa:empresa,ids:ids,
  usuario:porPessoa?destino:"",
  grupo_id:porPessoa?"":destino,
  motivo:$("motivoRecontagem").value.trim()};
 try{
  $("btnSolicitarRecontagem").disabled=true;
  var resposta=await api("/brastorno/inventario/recontagens","POST",body);
  limparRecontagem();
  $("motivoRecontagem").value="";
  await carregarConferencia();
  aviso(resposta.quantidade+" material(is) enviado(s) para recontagem de "+nomeDestino+".");
 }catch(ex){
  erroRecontagem(erroMsg(ex));
  atualizarSelecaoRecontagem();
 }
}
window.BRMarcarRecontagem=marcarRecontagem;
window.BRSelecionarTodasRecontagens=selecionarTodasRecontagens;
window.BRLimparRecontagem=limparRecontagem;
window.BRRecontarItem=recontarItem;
window.BRDestinoRecontagem=destinoRecontagem;
window.BRSolicitarRecontagem=solicitarRecontagem;

async function decidir(id,aplicar){
 if(!confirm(aplicar?"CONFIRMAR GRAVACAO REAL NO CPS? O estoque sera ajustado e registrado no Kardex.":"Rejeitar esta contagem?"))return;
 try{
  var acao=aplicar?"aplicar":"rejeitar";
  await api("/brastorno/inventario/conferencias/"+encodeURIComponent(id)+"/"+acao+"?cod_empresa="+empresa,"POST",{});
  aviso(aplicar?"Conferencia aplicada no CPS.":"Contagem rejeitada.");
  carregarConferencia();
 }catch(e){aviso(erroMsg(e),true)}
}
function csvExport(){
 var linhas=[["Empresa","Codigo","Produto","Unidade","Local","Saldo","Reservado","Preco Custo","Custo Fiscal","OS"]];
 itens.forEach(function(p){linhas.push([empresa,p.codigo_interno,p.produto,p.unidade,local(p),p.qtde_total,p.qtde_reservada,p.preco_custo,p.preco_custo_fiscal,
  (p.reservas_os||[]).map(function(r){return r.n_os||"SEM OS"}).join("; ")])});
 var csv="\ufeff"+linhas.map(function(row){return row.map(function(c){return '"'+String(c===null||c===undefined?"":c).replace(/"/g,'""')+'"'}).join(";")}).join("\r\n");
 var a=document.createElement("a"),url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
 a.href=url;a.download="BRASTORNO_INVENTARIO_EMPRESA_"+empresa+".csv";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function logout(){localStorage.removeItem("brastorno_token");localStorage.removeItem("brastorno_usuario_nome");location.href="../login.html"}
window.BRFiltrar=aplicarFiltro;window.BRLimparFiltros=limparFiltros;window.BRToggleFiltros=togglePainelFiltros;

function optionList(sel,items,selected,placeholder){
 if(!sel)return;
 sel.innerHTML="<option value=''>"+esc(placeholder||"Selecione...")+"</option>";
 items.forEach(function(it){
  var obj=typeof it==="object"?it:{id:it,nome:it};
  var opt=document.createElement("option");
  opt.value=String(obj.id);opt.textContent=puro(obj.nome);
  sel.add(opt);
 });
 if(selected!==undefined)sel.value=selected;
}
async function carregarEquipes(){
 try{
  var res=await Promise.all([
    api("/brastorno/inventario/grupos?cod_empresa="+empresa),
    api("/brastorno/inventario/usuarios"),
    api("/brastorno/inventario/tolerancias?cod_empresa="+empresa)
  ]);
  equipes=res[0].grupos||[];usuariosInventario=res[1].usuarios||[];
  optionList($("grupoEditar"),equipes,"","Selecione um grupo...");
  optionList($("destinoGrupo"),equipes,"","Selecione um grupo...");
  optionList($("destinoPessoa"),usuariosInventario.map(function(x){return {id:x,nome:x}}),"","Selecione um usuario...");
  var grupoAtual=$("filtroGrupoAtribuido").value,usuarioAtual=$("filtroUsuarioAtribuido").value;
  optionList($("filtroGrupoAtribuido"),equipes,grupoAtual,"Todos os grupos");
  optionList($("filtroUsuarioAtribuido"),usuariosInventario.map(function(x){return {id:x,nome:x}}),usuarioAtual,"Todos os usuarios");
  $("usuariosGrupo").innerHTML="";
  $("resumoGrupos").textContent=equipes.length+" grupo(s) configurado(s).";
  $("listaTolerancias").innerHTML=(res[2].tolerancias||[]).map(function(x){
   return "<span class='chip chip-tolerancia'>"+esc(x.unidade)+" | ±"+fmt(x.percentual)+"%</span>"
  }).join("")||"<p class='info-suave'>Nenhuma tolerancia salva.</p>";
  await carregarAtribuicoes();
 }catch(e){aviso("Configuracao de equipes: "+erroMsg(e),true)}
}
function grupoEscolher(){
 var g=equipes.find(function(x){return x.id===$("grupoEditar").value});
 $("usuariosGrupo").innerHTML=usuariosInventario.map(function(u){
  var marcado=g&&g.integrantes&&g.integrantes.includes(u);
  return "<label class='usuario-check'><input type='checkbox' data-grupo-usuario value='"+esc(u)+"' "+
   (marcado?"checked":"")+"> "+esc(u)+"</label>";
 }).join("");
}
async function grupoCriar(){
 var nome=$("nomeGrupo").value.trim();if(!nome){aviso("Informe o nome do grupo.",true);return}
 try{
  await api("/brastorno/inventario/grupos","POST",{cod_empresa:empresa,nome:nome});
  $("nomeGrupo").value="";
  aviso("Grupo criado. Inclua integrantes antes de distribuir materiais.");
  await carregarEquipes();
 }catch(e){aviso(erroMsg(e),true)}
}
async function membrosSalvar(){
 var gid=$("grupoEditar").value;
 if(!gid){aviso("Selecione um grupo.",true);return}
 var integrantes=Array.from(document.querySelectorAll("[data-grupo-usuario]:checked")).map(function(x){return x.value});
 try{
  await api("/brastorno/inventario/grupos/"+encodeURIComponent(gid)+"/integrantes","POST",
   {cod_empresa:empresa,integrantes:integrantes});
  aviso("Integrantes salvos.");await carregarEquipes();$("grupoEditar").value=gid;grupoEscolher();
 }catch(e){aviso(erroMsg(e),true)}
}
function destinoTipo(){
 var grupo=$("destinoTipo").value==="grupo";
 $("destinoGrupoWrap").hidden=!grupo;
 $("destinoPessoaWrap").hidden=grupo;
}
async function distribuir(){
 var tipo=$("destinoTipo").value;
 var grupo=tipo==="grupo"?$("destinoGrupo").value:"";
 var usuario=tipo==="usuario"?$("destinoPessoa").value:"";
 if(!grupo&&!usuario){aviso("Selecione um grupo ou usuario.",true);return}
 var codes=$("codigosDistribuicao").value.trim();
 var vals=codes?codes.split(/[\s,;\n]+/).filter(Boolean).map(Number):[];
 if(vals.some(function(n){return !Number.isInteger(n)||n<=0})){aviso("Codigos de produtos invalidos.",true);return}
 var filtros={};
 camposFiltros.forEach(function(k){var x=$("dist_"+k);if(x&&x.value)filtros[k]=x.value});
 var busca=$("buscaDistribuicao").value.trim();
 if(!codes&&!busca&&!Object.keys(filtros).length){aviso("Informe produtos ou filtros para distribuir.",true);return}
 if(!confirm("Atribuir materiais selecionados? Itens ja atribuidos serao ignorados."))return;
 try{
  var d=await api("/brastorno/inventario/atribuicoes","POST",
   {cod_empresa:empresa,usuario:usuario,grupo_id:grupo,cod_produtos:vals,filtros:filtros,busca:busca});
  aviso(d.atribuidos+" materiais atribuidos. "+d.ignorados+" ignorados.");
  $("codigosDistribuicao").value="";await carregarAtribuicoes();
 }catch(e){aviso(erroMsg(e),true)}
}
function filtrosDistribuicao(){
 return {status:$("statusAtribuicao").value,
         grupo_id:$("filtroGrupoAtribuido").value,
         usuario:$("filtroUsuarioAtribuido").value};
}
function filtrosAtribuicaoAlterados(){
 selecaoAtrib.clear();carregarAtribuicoes();
}
function alternarSelecao(codigo,ativo){
 if(ativo)selecaoAtrib.add(Number(codigo));else selecaoAtrib.delete(Number(codigo));
 atualizarBarraRemocao();
}
function selecionarVisiveis(marcar){
 listaAtribAtual.filter(function(r){return r.status==="ATRIBUIDO"}).forEach(function(r){
  if(marcar)selecaoAtrib.add(Number(r.cod_produto));else selecaoAtrib.delete(Number(r.cod_produto));
 });
 document.querySelectorAll("[data-check-atribuicao]").forEach(function(c){c.checked=marcar});
 atualizarBarraRemocao();
}
function atualizarBarraRemocao(){
 var filtros=filtrosDistribuicao(),grupoOuUsuario=!!(filtros.grupo_id||filtros.usuario);
 $("contadorSelecaoAtrib").textContent=selecaoAtrib.size+" material(is) selecionado(s)";
 $("btnRemoverSelecionados").disabled=selecaoAtrib.size===0;
 $("btnRemoverFiltrados").disabled=!grupoOuUsuario||!(listaAtribAtual.length);
}
async function carregarAtribuicoes(){
 var serial=++consultaAtribSerial,eAtual=empresa;
 try{
  var filtros=filtrosDistribuicao();
  var query="/brastorno/inventario/atribuicoes?cod_empresa="+eAtual+
    "&status="+filtros.status+"&limite=120"+parametrosFiltros();
  if(filtros.grupo_id)query+="&grupo_atribuido="+encodeURIComponent(filtros.grupo_id);
  if(filtros.usuario)query+="&usuario_atribuido="+encodeURIComponent(filtros.usuario);
  var d=await api(query);
  if(serial!==consultaAtribSerial||eAtual!==empresa)return;
  listaAtribAtual=d.atribuicoes||[];
  selecaoAtrib.clear();
  var out="<div class='tabela'><table><thead><tr>"+
    "<th><input type='checkbox' aria-label='Selecionar exibidos para remocao' onchange='BRSelecionarVisiveis(this.checked)'></th>"+
    "<th>Codigo</th><th>Material</th><th>Usuario / Grupo</th><th>Status</th><th>Acao</th></tr></thead><tbody>";
  listaAtribAtual.forEach(function(r){
   var apto=r.status==="ATRIBUIDO";
   out+="<tr><td>"+(apto?"<input type='checkbox' data-check-atribuicao onchange='BRSelecionar("+r.cod_produto+",this.checked)' aria-label='Selecionar material'>":"")+"</td>"+
   "<td>"+esc(r.codigo_interno||r.cod_produto)+"</td><td>"+esc(r.produto)+"</td>"+
   "<td>"+esc(r.usuario||r.grupo_nome||"")+"</td><td>"+esc(r.status)+"</td>"+
   "<td>"+(apto?"<button class='mini' onclick='BRDesatribuir("+r.cod_produto+")'>Remover</button>":"")+"</td></tr>";
  });
  $("listaAtribuicoes").innerHTML=out+(listaAtribAtual.length?"":"<tr><td colspan='6'>Sem materiais neste filtro.</td></tr>")+
   "</tbody></table></div><p class='info-suave'>"+fmt(d.total)+" materiais. Exibindo ate 120. Removiveis: "+fmt(d.removiveis||0)+".</p>";
  $("limiteRemocao").textContent="Apenas atribuicoes nao contadas podem ser removidas. Ate 500 selecionados ou 2.000 filtrados.";
  atualizarBarraRemocao();
  $("btnRemoverFiltrados").disabled=!(d.removiveis>0)||!(filtros.grupo_id||filtros.usuario);
 }catch(e){if(serial===consultaAtribSerial)$("listaAtribuicoes").textContent=erroMsg(e)}
}
async function removerLote(todos){
 var filtros=filtrosDistribuicao(),itens=[...selecaoAtrib];
 if(todos&&!(filtros.grupo_id||filtros.usuario)){aviso("Selecione um grupo de contagem ou usuario para remover todos.",true);return}
 if(!todos&&!itens.length){aviso("Marque os materiais que deseja remover.",true);return}
 if(!todos&&itens.length>500){aviso("Maximo de 500 materiais selecionados por operacao.",true);return}
 var descricao=todos?"TODOS OS MATERIAIS AINDA NAO CONTADOS DO GRUPO/USUARIO FILTRADO":itens.length+" materiais selecionados";
 if(!confirm("REMOVER ATRIBUICOES: "+descricao+"?\nNao remove materiais ja contados.\nEsta acao NAO altera o estoque no CPS."))return;
 var payload={cod_empresa:empresa,cod_produtos:todos?[]:itens,
   grupo_id:filtros.grupo_id,usuario_atribuido:filtros.usuario,todos_filtrados:!!todos,
   busca:$("pesquisa").value.trim(),filtros:{}};
 camposFiltros.forEach(function(k){if(filtrosAtivos[k])payload.filtros[k]=filtrosAtivos[k]});
 try{
  $("btnRemoverSelecionados").disabled=true;$("btnRemoverFiltrados").disabled=true;
  var r=await api("/brastorno/inventario/atribuicoes/remover-lote","POST",payload);
  aviso(r.removidos+" atribuicao(oes) removida(s). Nenhum estoque alterado.");
  await carregarAtribuicoes();
 }catch(e){aviso(erroMsg(e),true);atualizarBarraRemocao()}
}
window.BRFiltroAtribuicoes=filtrosAtribuicaoAlterados;
window.BRSelecionar=alternarSelecao;
window.BRSelecionarVisiveis=selecionarVisiveis;
window.BRRemoverLote=removerLote;

async function desatribuir(codigo){
 if(!confirm("Remover a atribuicao do produto "+codigo+"?"))return;
 try{
  await api("/brastorno/inventario/atribuicoes/remover","POST",{cod_empresa:empresa,cod_produto:codigo});
  aviso("Material removido da distribuicao.");carregarAtribuicoes();
 }catch(e){aviso(erroMsg(e),true)}
}
async function toleranciaSalvar(){
 var un=$("tolUnidade").value.trim().toUpperCase();
 var pct=$("tolPercentual").value;
 if(!un||pct===""||!Number.isFinite(Number(pct))){aviso("Informe unidade e percentual.",true);return}
 try{
  await api("/brastorno/inventario/tolerancias","POST",{cod_empresa:empresa,unidade:un,percentual:Number(pct)});
  $("tolUnidade").value="";$("tolPercentual").value="";
  aviso("Tolerancia salva.");await carregarEquipes();
 }catch(e){aviso(erroMsg(e),true)}
}
window.BRDistFiltrar=aplicarFiltroDist;
window.BRGrupoCriar=grupoCriar;
window.BRGrupoEscolher=grupoEscolher;
window.BRMembrosSalvar=membrosSalvar;
window.BRDestinoTipo=destinoTipo;
window.BRDistribuir=distribuir;
window.BRCargaAtribuicoes=carregarAtribuicoes;
window.BRDesatribuir=desatribuir;
window.BRToleranciaSalvar=toleranciaSalvar;
window.BRFiltrarMetodoReposicao=filtrarMetodoReposicao;
window.BRAba=trocarAba;window.BREmpresa=setEmpresa;window.BRPagina=function(delta){pagina=Math.max(1,pagina+delta);carregarItens()};
window.BRQtd=mudaQuantidade;window.BRLotes=lotes;window.BRAdicionarLote=adicionarLote;window.BRSalvarLotes=salvarLotes;
window.BRFecharModal=function(){$("modal").hidden=true};window.BREnviar=enviarContagens;window.BRGravarConfig=gravarConfig;
window.BRDecidir=decidir;window.BRCarregarConferencia=carregarConferencia;window.BRExportar=csvExport;window.BRLogout=logout;
$("pesquisa").addEventListener("input",function(){clearTimeout(temporizador);temporizador=setTimeout(function(){pagina=1;recarregarAba();carregarFiltros("main")},350)});
$("limparBusca").addEventListener("click",function(){$("pesquisa").value="";pagina=1;recarregarAba();carregarFiltros("main")});
$("empresa").value=empresa;
$("filtroMetodoReposicao").value=metodoReposicao;
(async function(){
 try{
  perfil=await api("/brastorno/inventario/perfil");
  if(!perfil.inventario)throw Error("Usuario sem liberacao de inventario.");
  $("usuario").textContent=puro(perfil.usuario);
  if(!perfil.inventario_gestor){
   document.querySelectorAll("[data-gestor]").forEach(function(x){x.hidden=true});
  }
  var inicial=localStorage.getItem("br_invent_aba")||"contagem";
  if(!perfil.inventario_gestor)inicial="contagem";
  trocarAba(inicial);
 }catch(e){$("corpo").innerHTML="<div class='erro-caixa'>"+esc(erroMsg(e))+
  "<br>Verifique a instalacao da API WEB e as permissoes CSENHA U_INVENT / U_INVENT_GESTOR.</div>";}
})();
})();