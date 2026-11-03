(function(){
"use strict";
var API="https://brastorno.consultoriarf.net";
var TOKEN=localStorage.getItem("brastorno_token");
if(!TOKEN){location.replace("../login.html");return;}
var perfil=null,aba="contagem",empresa=Number(localStorage.getItem("br_invent_empresa")||1),pagina=1,limite=75;
var itens=[],rascunhos={},temporizador=null,cabecalhoConsulta=null;
var camposFiltros=["familia","grupo","subgrupo1","subgrupo2","subgrupo3","subgrupo4","subgrupo5","subgrupo6","subgrupo7","local_estoque"];
var filtrosAtivos={};var consultaSerial=0;
var equipes=[],usuariosInventario=[];
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
 if(!r.ok)throw Error((val&&val.detail)||"Erro HTTP "+r.status);
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
 $("exportarInventario").hidden=(id!=="reservados");
 aviso("");
 if(id==="parametrizacoes"){carregarConfig();carregarEquipes();}
 else if(id==="conferencia")carregarConferencia();
 else carregarItens();
}
function setEmpresa(v){
 empresa=Number(v)||1;pagina=1;rascunhos={};filtrosAtivos={};
 localStorage.setItem("br_invent_empresa",empresa);
 camposFiltros.forEach(function(k){var el=$("filtro_"+k);if(el)el.value=""});
 carregarFiltros();trocarAba(aba)
}
async function carregarFiltros(){
 var empresaInicio=empresa;
 $("msgFiltros").textContent="Carregando opcoes...";
 try{
  var resultado=await api("/brastorno/inventario/filtros?cod_empresa="+empresaInicio);
  if(empresaInicio!==empresa)return;
  camposFiltros.forEach(function(k){
   var select=$("filtro_"+k),valor=String(filtrosAtivos[k]||"");
   if(!select)return;
   select.innerHTML="<option value=''>Todos</option>";
   (resultado.filtros[k]||[]).forEach(function(v){
    var opt=document.createElement("option");opt.value=v;opt.textContent=puro(v);select.add(opt);
   });
   select.value=valor;
   var dest=$("dist_"+k);
   if(dest){
    var vAntigo=dest.value;
    dest.innerHTML="<option value=''>Todos</option>";
    (resultado.filtros[k]||[]).forEach(function(v){
     var opt=document.createElement("option");opt.value=v;opt.textContent=puro(v);dest.add(opt);
    });
    dest.value=vAntigo;
   }
  });
  $("msgFiltros").textContent="Familia, grupo, subgrupos 1 a 7 e local de estoque";
 }catch(e){$("msgFiltros").textContent="Nao foi possivel carregar os filtros: "+erroMsg(e)}
}
function aplicarFiltro(){
 camposFiltros.forEach(function(k){var x=$("filtro_"+k);filtrosAtivos[k]=x?x.value:""});
 var usados=camposFiltros.filter(function(k){return !!filtrosAtivos[k]}).length;
 $("btnFiltro").textContent="Filtros"+(usados?" ("+usados+")":"");
 pagina=1;recarregarAba();
}
function limparFiltros(){
 filtrosAtivos={};camposFiltros.forEach(function(k){var x=$("filtro_"+k);if(x)x.value=""});
 $("btnFiltro").textContent="Filtros";pagina=1;recarregarAba();
}
function recarregarAba(){
 if(aba==="conferencia")carregarConferencia();
 else if(aba==="parametrizacoes")carregarAtribuicoes();
 else carregarItens();
}
function parametrosFiltros(){
 var q="&busca="+encodeURIComponent($("pesquisa").value.trim());
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
 var out="<div class='tabela'><table><thead><tr><th>Codigo</th><th>Material</th><th>Familia</th><th>Grupo</th><th>Subgrupos 1 a 7</th><th>Unid.</th><th>Local de estoque</th><th>Contagem fisica</th><th>Lotes / Series</th></tr></thead><tbody>";
 itens.forEach(function(p){
  var cod=p.cod_produto,lote=[1,2,3].includes(Number(p.tipo_controle)),d=rascunhos[cod];
  out+="<tr>"+rowsBase(p);
  out+="<td>"+(lote?"<span class='contagem-valor'>"+(d?fmt(d.qtde):"Nao contada")+"</span>":
     "<input class='qtd' type='number' step='any' min='0' placeholder='Contar...' value='"+(d?esc(d.qtde):"")+
     "' oninput='BRQtd("+cod+",this.value)' autocomplete='off'>")+"</td>";
  out+="<td>"+(lote?"<button class='mini' onclick='BRLotes("+cod+")'>Contar lotes</button>":"")+
    (p.lotes&&p.lotes.length?"<small>"+p.lotes.length+" lote(s) identificado(s)</small>":"")+"</td></tr>";
 });
 $("lista").innerHTML=out+(itens.length?"":"<tr><td colspan='9'>Nenhum material encontrado.</td></tr>")+"</tbody></table></div>";
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
  carregarFiltros();aviso("Parametrizacoes salvas para empresa "+empresa+".");
 }catch(e){aviso(erroMsg(e),true)}
}
async function carregarConferencia(){
 $("listaConferencia").innerHTML="<p>Carregando contagens...</p>";
 try{
  var status=$("statusConferencia").value;
  var d=await api("/brastorno/inventario/contagens?cod_empresa="+empresa+"&status="+status+"&pagina=1&limite=250"+parametrosFiltros());
  var todas=d.contagens||[];
  var bloqueados=todas.filter(function(r){return r.status==="PENDENTE"&&r.segregado_reserva});
  var regulares=todas.filter(function(r){return !(r.status==="PENDENTE"&&r.segregado_reserva)});
  function tabela(rows){
   var out="<div class='tabela'><table><thead><tr><th>Data</th><th>Material</th><th>Contador</th><th>Unid.</th><th>Saldo CPS</th><th>Reservado</th><th>Contado</th><th>Diferenca</th><th>Tolerancia</th><th>Impacto custo</th><th>Status</th><th>Acao</th></tr></thead><tbody>";
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
    out+="<tr class='"+(abaixo?"linha-bloqueada":"")+"'><td>"+esc(r.criada_em)+"</td>"+
      "<td><b>"+esc(r.codigo_interno||("#"+r.cod_produto))+"</b><small>"+esc(r.produto)+"</small></td>"+
       "<td>"+esc(r.usuario)+"</td><td>"+esc(unidadeExibida||"—")+"</td>"+
      "<td class='direita'>"+fmt(saldo)+"</td><td class='direita'>"+fmt(r.qtde_reservada_atual)+"</td>"+
      "<td class='direita'>"+fmt(qtd)+"</td><td class='direita "+(dif<0?"negativo":"")+"'>"+fmt(dif)+"</td>"+
      "<td class='"+estiloTol+"'>"+esc(tolText)+"</td>"+
      "<td class='direita'>"+moeda(dif*num(r.preco_custo))+"</td>"+
      "<td>"+(abaixo?"<span class='tag-bloqueio'>ABAIXO DA RESERVA</span>":esc(r.status))+"</td>"+
      "<td>"+(r.status!=="PENDENTE"?"":abaixo?
        "<span class='motivo-bloqueio'>Gravacao bloqueada. Regularizar reserva ou recontar.</span>"+
        "<button class='mini' onclick='BRDecidir(\""+esc(r.id)+"\",false)'>Recontagem</button>":
        "<button class='mini destaque' onclick='BRDecidir(\""+esc(r.id)+"\",true)'>Aplicar no CPS</button>"+
        "<button class='mini' onclick='BRDecidir(\""+esc(r.id)+"\",false)'>Rejeitar</button>")+"</td></tr>";
   });
   return out+(rows.length?"":"<tr><td colspan='12'>Nenhuma contagem.</td></tr>")+"</tbody></table></div>";
  }
  var html="<div class='segregacao-bloco'><div class='segregacao-titulo'><strong>ABAIXO DA QUANTIDADE RESERVADA</strong><span class='tag-bloqueio'>"+bloqueados.length+" item(ns)</span></div>"+
    "<p class='alerta-reserva'>Estes itens estao separados e nao podem ajustar o estoque enquanto a reserva real no CPS superar a contagem.</p>"+
    tabela(bloqueados)+"</div>"+
    "<div class='segregacao-bloco'><div class='segregacao-titulo'><strong>DEMAIS CONTAGENS</strong><span>"+regulares.length+" item(ns)</span></div>"+
    tabela(regulares)+"</div>"+
    "<p class='info-suave'>"+fmt(d.total)+" contagem(ns). Exibindo ate 250 por consulta.</p>";
  $("listaConferencia").innerHTML=html;
 }catch(e){$("listaConferencia").innerHTML="<div class='erro-caixa'>"+esc(erroMsg(e))+"</div>";aviso(erroMsg(e),true)}
}
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
async function carregarAtribuicoes(){
 try{
  var status=$("statusAtribuicao").value;
  var d=await api("/brastorno/inventario/atribuicoes?cod_empresa="+empresa+"&status="+status+"&limite=120"+parametrosFiltros());
  var out="<div class='tabela'><table><thead><tr><th>Codigo</th><th>Material</th><th>Usuario / Grupo</th><th>Status</th><th>Acao</th></tr></thead><tbody>";
  (d.atribuicoes||[]).forEach(function(r){
   out+="<tr><td>"+esc(r.codigo_interno||r.cod_produto)+"</td><td>"+esc(r.produto)+"</td>"+
   "<td>"+esc(r.usuario||r.grupo_nome||"")+"</td><td>"+esc(r.status)+"</td>"+
   "<td>"+(r.status==="ATRIBUIDO"?"<button class='mini' onclick='BRDesatribuir("+r.cod_produto+")'>Remover atribuicao</button>":"")+"</td></tr>";
  });
  $("listaAtribuicoes").innerHTML=out+(d.atribuicoes.length?"":"<tr><td colspan='5'>Sem materiais atribuidos.</td></tr>")+
   "</tbody></table></div><p class='info-suave'>"+fmt(d.total)+" materiais. Exibindo ate 120.</p>";
 }catch(e){$("listaAtribuicoes").textContent=erroMsg(e)}
}
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
window.BRGrupoCriar=grupoCriar;
window.BRGrupoEscolher=grupoEscolher;
window.BRMembrosSalvar=membrosSalvar;
window.BRDestinoTipo=destinoTipo;
window.BRDistribuir=distribuir;
window.BRCargaAtribuicoes=carregarAtribuicoes;
window.BRDesatribuir=desatribuir;
window.BRToleranciaSalvar=toleranciaSalvar;
window.BRAba=trocarAba;window.BREmpresa=setEmpresa;window.BRPagina=function(delta){pagina=Math.max(1,pagina+delta);carregarItens()};
window.BRQtd=mudaQuantidade;window.BRLotes=lotes;window.BRAdicionarLote=adicionarLote;window.BRSalvarLotes=salvarLotes;
window.BRFecharModal=function(){$("modal").hidden=true};window.BREnviar=enviarContagens;window.BRGravarConfig=gravarConfig;
window.BRDecidir=decidir;window.BRCarregarConferencia=carregarConferencia;window.BRExportar=csvExport;window.BRLogout=logout;
$("pesquisa").addEventListener("input",function(){clearTimeout(temporizador);temporizador=setTimeout(function(){pagina=1;recarregarAba()},350)});
$("limparBusca").addEventListener("click",function(){$("pesquisa").value="";pagina=1;recarregarAba()});
$("empresa").value=empresa;carregarFiltros();
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