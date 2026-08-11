/**
 * ponto-timesheet.js - Folha de Ponto (timesheet) do módulo de Ponto
 *
 * Porte de `gerarTimesheetAcordo()` do sistema Ponto original
 * (app-refatorado.js:4611-5498). A grade é o formato de calendário que o
 * usuário já usava: um bloco por mês do ano fiscal do acordo, dias como
 * colunas, 10 linhas fixas (Entrada … Saldo do Dia), colunas verticais de
 * Saldo Anterior/Saldo Acumulado nas pontas e a linha SALDO MÊS no rodapé.
 *
 * As regras de saldo (quais eventos bloqueiam o cômputo, como o saldo
 * acumulado atravessa meses e anos fiscais) foram mantidas EXATAMENTE como no
 * original — isto tem peso de conformidade trabalhista, divergir aqui é bug,
 * não melhoria.
 */
(function () {
    var esc = function (v) { return (window.Utils && Utils.escapeHtml) ? Utils.escapeHtml(v) : String(v == null ? '' : v); };

    var MES_NOMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                     'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    var DIA_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    var NUM_ROWS = 10;
    var LABELS = [
        'Entrada', 'Saída (Almoço)', 'Duração (Almoço)', 'Retorno (Almoço)', 'Saída',
        '', 'Observações', 'Ponto da Saída', 'Horas Trabalhadas', 'Saldo do Dia'
    ];

    // Eventos que NÃO bloqueiam o cômputo do saldo do dia (mesma lista do original).
    var TIPOS_NAO_CONTAR_SALDO = ['pagar_hora_acordo', 'compensar_acordo', 'compensacao_acordo',
                                  'compensação_acordo', 'pagar_hora', 'abono_acordo', 'abono'];
    // Esses tipos nunca viram célula mesclada — sempre célula normal colorida.
    var TIPOS_NAO_MESCLAR = TIPOS_NAO_CONTAR_SALDO;

    // Justificativas de atestado médico (grupo "Atestado Médico" do modal de Registro,
    // ver GRUPOS_ATESTADO em ponto-ui.js) — pintam só as linhas de horário cobertas,
    // sem célula mesclada e sem texto nenhum na célula.
    var TIPOS_ATESTADO_MEDICO = ['afastamento', 'comparecimento_matutino', 'comparecimento_vespertino'];

    function hhmm(min) { return PontoCalculos.minutosParaHHMM(min); }

    function parseData(s) {
        if (!s) return null;
        var m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        var d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    }

    function isoDe(ano, mes, dia) {
        return ano + '-' + String(mes + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    }

    /** Acordos ordenados do mais novo para o mais antigo, preservando o índice original. */
    function acordosOrdenados() {
        return PontoStore.listarAcordos().map(function (a, i) {
            var maisRecente = (a.periodos || []).reduce(function (acc, p) {
                var d = parseData(p.inicio);
                return (d && (!acc || d > acc)) ? d : acc;
            }, null);
            return { a: a, i: i, ref: maisRecente };
        }).sort(function (x, y) { return (y.ref || 0) - (x.ref || 0); });
    }

    /** Índice do acordo cujo período cobre hoje; senão o mais novo. */
    function acordoPadrao() {
        var ord = acordosOrdenados();
        if (!ord.length) return null;
        var hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        for (var k = 0; k < ord.length; k++) {
            var periodos = ord[k].a.periodos || [];
            for (var j = 0; j < periodos.length; j++) {
                var ini = parseData(periodos[j].inicio), fim = parseData(periodos[j].fim);
                if (ini && fim && hoje >= ini && hoje <= fim) return ord[k].i;
                if (ini && !fim && hoje >= ini) return ord[k].i;
            }
        }
        return ord[0].i;
    }

    // ──────────────────────────────────────────────
    //  Janela do ano fiscal do acordo (abril → março)
    // ──────────────────────────────────────────────
    function janelaFiscal(acordo) {
        var fiscalStartMonth = 3; // Abril (0-based)
        if (acordo && acordo.fiscalStartMonth != null) {
            var raw = Number(acordo.fiscalStartMonth);
            if (!isNaN(raw)) {
                var cand = (raw >= 1 && raw <= 12) ? raw - 1 : raw;
                if (cand >= 0 && cand <= 11) fiscalStartMonth = cand;
            }
        }

        var maisRecente = (acordo.periodos || []).reduce(function (acc, p) {
            var d = parseData(p.inicio);
            return (d && (!acc || d > acc)) ? d : acc;
        }, null);

        var fiscalStartYear;
        if (maisRecente) {
            fiscalStartYear = (maisRecente.getMonth() >= fiscalStartMonth)
                ? maisRecente.getFullYear() : maisRecente.getFullYear() - 1;
        } else {
            var now = new Date();
            fiscalStartYear = (now.getMonth() >= fiscalStartMonth) ? now.getFullYear() : now.getFullYear() - 1;
        }

        // Nome no formato "2025-2026" tem prioridade sobre a inferência acima.
        if (acordo && acordo.nome) {
            var mn = acordo.nome.match(/(\d{4})\s*[-\/]\s*(\d{4})/);
            if (mn && !isNaN(Number(mn[1]))) fiscalStartYear = Number(mn[1]);
        }

        return {
            inicio: new Date(fiscalStartYear, fiscalStartMonth, 1),
            fim: new Date(fiscalStartYear + 1, fiscalStartMonth, 0)
        };
    }

    /** Saldo do dia que efetivamente entra na soma do mês (respeita evento bloqueante). */
    function saldoComputavel(ctx, iso) {
        var reg = ctx.mapaReg[iso];
        var calc = PontoCalculos.calculateDayWithContext(ctx.registros, ctx.eventos, ctx.acordos, iso, reg);
        var ev = calc.evento;
        var bloqueia = ev && TIPOS_NAO_CONTAR_SALDO.indexOf(ev.tipoEvento) === -1 && (ev.periodo || 'dia_todo') === 'dia_todo';
        if (!bloqueia && (calc.temRegistro || (!calc.temRegistro && calc.saldo < 0))) return calc.saldo || 0;
        return 0;
    }

    function somaMes(ctx, ano, mes) {
        var ultimo = new Date(ano, mes + 1, 0).getDate();
        var total = 0;
        for (var d = 1; d <= ultimo; d++) total += saldoComputavel(ctx, isoDe(ano, mes, d));
        return total;
    }

    /** Primeira data relevante de todo o sistema — define qual mês tem Saldo Anterior = 0. */
    function primeiraDataGlobal(ctx, acordo) {
        var earliest = null;
        ctx.acordos.forEach(function (ac) {
            if (ac && ac.criadoEm) {
                var c = new Date(ac.criadoEm);
                if (!isNaN(c.getTime()) && (!earliest || c < earliest)) earliest = c;
            }
            (ac.periodos || []).forEach(function (p) {
                var pd = parseData(p.inicio);
                if (pd && (!earliest || pd < earliest)) earliest = pd;
            });
        });
        if (earliest) return earliest;

        ctx.registros.forEach(function (r) {
            var d = parseData(r.data);
            if (d && (!earliest || d < earliest)) earliest = d;
        });
        (acordo.periodos || []).forEach(function (p) {
            var d = parseData(p.inicio);
            if (d && (!earliest || d < earliest)) earliest = d;
        });
        return earliest;
    }

    // ──────────────────────────────────────────────
    //  Evento visual de cada dia da grade
    // ──────────────────────────────────────────────
    // Pseudo-eventos que o Ponto original auto-gerava a cada registro salvo com
    // período (`linkedRegistroDate`/`nomeCSS: 'evento-registro'`, ver mesmo
    // conceito em crm-ui.js/ehEventoDeRegistroPonto) — dados legados, viram
    // ruído na grade (ex: "Registro: dia todo") e nunca devem representar a
    // justificativa de um registro, que já é pintada linha a linha mais abaixo.
    function ehEventoLinkadoRegistro(ev) {
        return !!(ev.linkedRegistroDate || ev.nomeCSS === 'evento-registro');
    }

    function eventoDoDia(ctx, iso) {
        var ev = PontoCalculos.getEventoByData(ctx.eventos, iso);
        if (ev && !ehEventoLinkadoRegistro(ev)) return ev;

        // Férias vindas de periodosAquisitivos (não são eventos, mas pintam a grade).
        var data = parseData(iso);
        if (data) {
            var emFerias = ctx.periodosAquisitivos.filter(function (p) {
                if (!p.feriasInicio || !p.feriasFim) return false;
                var i = parseData(p.feriasInicio), f = parseData(p.feriasFim);
                return i && f && data >= i && data <= f;
            })[0];
            if (emFerias) {
                return { tipoEvento: 'ferias', descricaoEvento: 'Férias', periodo: 'dia_todo', impactoEvento: 'folga' };
            }
        }

        // Evento sintético a partir de um registro marcado com período.
        // Atestado médico (afastamento/comparecimento) não vira célula mesclada —
        // é pintado linha a linha mais abaixo, sem texto na célula.
        var reg = ctx.mapaReg[iso];
        if (reg && TIPOS_ATESTADO_MEDICO.indexOf(reg.tipoAtestado) !== -1) return null;
        if (reg && reg.periodoEvento && (reg.createLinkedEvent === undefined || reg.createLinkedEvent)) {
            var tipo = (reg.tipoEventoRegistro && ctx.tiposEvento.some(function (t) { return t.id === reg.tipoEventoRegistro; }))
                ? reg.tipoEventoRegistro : 'outro';
            return {
                tipoEvento: tipo,
                descricaoEvento: reg.observacoes || 'Evento (registro)',
                periodo: reg.periodoEvento,
                impactoEvento: 'trabalho'
            };
        }
        return null;
    }

    function classeEvento(tipo) {
        switch (tipo) {
            case 'feriado': return 'evento-feriado';
            case 'ferias': return 'evento-ferias';
            case 'afastamento': return 'evento-afastamento';
            case 'viagem': return 'evento-viagem';
            case 'abono': return 'evento-abono';
            case 'abono_acordo': return 'evento-abono-acordo';
            case 'pagar_hora_acordo': return 'evento-pagar-hora-acordo';
            default: return 'evento-outro';
        }
    }

    // ──────────────────────────────────────────────
    //  Render de um mês
    // ──────────────────────────────────────────────
    function renderMes(ctx, ano, mes, saldoAnterior, contadores) {
        var ultimoDia = new Date(ano, mes + 1, 0).getDate();
        var hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        var hojeIso = isoDe(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

        var dias = [];
        for (var d = 1; d <= ultimoDia; d++) {
            var dt = new Date(ano, mes, d);
            var dow = dt.getDay();
            var iso = isoDe(ano, mes, d);
            dias.push({ data: dt, iso: iso, dow: dow, fimDeSemana: (dow === 0 || dow === 6), isHoje: iso === hojeIso });
        }

        var eventos = dias.map(function (dia) { return eventoDoDia(ctx, dia.iso); });
        var eventoSpanCriado = dias.map(function () { return false; });
        var fimSemanaSpanCriado = dias.map(function () { return false; });

        function calcDia(iso) {
            return PontoCalculos.calculateDayWithContext(ctx.registros, ctx.eventos, ctx.acordos, iso, ctx.mapaReg[iso]);
        }

        var cabecalho = '<tr><th>TIPO</th><th class="th-saldo-anterior"></th>' +
            dias.map(function (dia) {
                var classHoje = dia.isHoje ? ' ts-dia-hoje' : '';
                return '<th class="' + classHoje + '"><div class="th-dia"><span class="th-dia-semana">' + DIA_SEM[dia.dow] + '</span>' +
                    '<span class="th-dia-num">' + dia.data.getDate() + '</span></div></th>';
            }).join('') +
            '<th class="th-saldo-acumulado"></th></tr>';

        var saldoMes = 0;
        var linhas = [];

        for (var rowIndex = 0; rowIndex < NUM_ROWS; rowIndex++) {
            var cells = ['<td>' + esc(LABELS[rowIndex]) + '</td>'];

            if (rowIndex === 0) {
                cells.push('<td rowspan="' + NUM_ROWS + '" class="col-saldo-anterior">' +
                    '<div class="saldo-vertical-text"><span>Saldo Anterior</span></div></td>');
            }

            /* eslint-disable no-loop-func */
            (function (rowIndex) {
                dias.forEach(function (dia, colIdx) {
                    var ev = eventos[colIdx];
                    var isCompensar = ev && TIPOS_NAO_MESCLAR.indexOf(ev.tipoEvento) !== -1;

                    // ── Evento que bloqueia visualmente a coluna (célula vertical mesclada) ──
                    if (ev && !isCompensar) {
                        var periodoEv = ev.periodo || 'dia_todo';
                        var startRow = 0, span = NUM_ROWS;
                        if (periodoEv === 'matutino') { startRow = 0; span = 4; }
                        else if (periodoEv === 'vespertino') { startRow = 3; span = 3; }

                        if (!eventoSpanCriado[colIdx] && rowIndex === startRow) {
                            var texto;
                            if (ev.tipoEvento === 'ferias') texto = 'Férias';
                            else if ((ev.tipoEvento === 'abono_acordo' || ev.tipoEvento === 'abono' || ev.tipoEvento === 'pagar_hora_acordo') &&
                                     (periodoEv === 'matutino' || periodoEv === 'vespertino')) texto = '';
                            else if (ev.tipoEvento === 'afastamento') texto = ev.descricaoEvento || 'Atestado';
                            else texto = ev.descricaoEvento || ev.tipoEvento;

                            cells.push('<td rowspan="' + span + '" class="' + classeEvento(ev.tipoEvento) +
                                ' evento-vertical evento-periodo-' + esc(periodoEv) + '">' + esc(texto) + '</td>');
                            eventoSpanCriado[colIdx] = true;
                            if (ev.tipoEvento === 'feriado') contadores.feriados++;
                        }
                        if (rowIndex >= startRow && rowIndex < startRow + span) return;
                    }

                    // ── Fim de semana (coluna cinza mesclada) ──
                    if (dia.fimDeSemana) {
                        if (!fimSemanaSpanCriado[colIdx] && rowIndex === 0) {
                            cells.push('<td rowspan="' + NUM_ROWS + '" class="col-fimsemana evento-vertical"></td>');
                            fimSemanaSpanCriado[colIdx] = true;
                        }
                        return;
                    }

                    // ── Dia útil ──
                    var r = ctx.mapaReg[dia.iso] || null;
                    var classes = [];
                    var conteudo = '';
                    var titulo = '';

                    if (isCompensar && ev) {
                        var pEv = ev.periodo || 'dia_todo';
                        var noEvento = (pEv === 'matutino' && rowIndex <= 3) ||
                                       (pEv === 'vespertino' && rowIndex >= 3 && rowIndex <= 5) ||
                                       (pEv === 'dia_todo' && rowIndex <= 5);
                        if (noEvento) {
                            if (ev.tipoEvento === 'abono_acordo' || ev.tipoEvento === 'abono') classes.push('evento-abono-periodo');
                            else if (ev.tipoEvento === 'pagar_hora_acordo') classes.push('evento-pagar-hora-periodo');
                        }
                    }

                    // Atestado/abono pintam apenas as linhas do período coberto (sem texto).
                    // Abono/Pagar Hora mostram abreviação como conteúdo.
                    if (r && r.tipoAtestado) {
                        var ehMat = r.tipoAtestado === 'comparecimento_matutino' || r.tipoAtestado === 'abono_matutino';
                        var ehVes = r.tipoAtestado === 'comparecimento_vespertino' || r.tipoAtestado === 'abono_vespertino';
                        var ehDia = r.tipoAtestado === 'abono_dia_todo' || r.tipoAtestado === 'afastamento';
                        var cobertas = ehMat ? [0, 1] : (ehVes ? [3, 4] : (ehDia ? [0, 1, 2, 3, 4] : []));
                        if (cobertas.indexOf(rowIndex) !== -1) {
                            classes.push(r.tipoAtestado.indexOf('abono_') === 0 ? 'ts-abono' : 'ts-atestado-comparecimento');
                            titulo = r.tipoAtestado.replace(/_/g, ' ');
                            // Mostrar abreviação só para abono e pagar_hora, não para atestado médico
                            if (r.tipoAtestado.indexOf('abono_') === 0 || r.tipoAtestado.indexOf('pagar_hora_') === 0) {
                                var just = PontoUI._justificativas && PontoUI._justificativas[r.tipoAtestado];
                                if (just) conteudo = just.abrev || just.texto;
                            }
                        }
                    }

                    if (rowIndex === 0) conteudo = (r && r.entrada) || '';
                    else if (rowIndex === 1) conteudo = (r && r.saidaAlmoco) || '';
                    else if (rowIndex === 2) {
                        if (r && r.saidaAlmoco && r.retornoAlmoco) {
                            var ini = PontoCalculos.timeToMinutes(r.saidaAlmoco);
                            var fimA = PontoCalculos.timeToMinutes(r.retornoAlmoco);
                            if (ini != null && fimA != null && fimA > ini) conteudo = hhmm(fimA - ini);
                        }
                    }
                    else if (rowIndex === 3) conteudo = (r && r.retornoAlmoco) || '';
                    else if (rowIndex === 4) conteudo = (r && r.saida) || '';
                    else if (rowIndex === 6) {
                        conteudo = (r && r.observacoes) || '';
                        classes.push('ts-clickable', 'timesheet-observacao');
                        titulo = 'Clique para editar observações';
                    }
                    else if (rowIndex === 7) {
                        // Ponto da Saída = entrada + almoço (60, como no original) + 8h + extras do acordo.
                        if (r && r.entrada) {
                            var c7 = calcDia(dia.iso);
                            if (c7 && c7.acordo) {
                                var periodoAcordo = (c7.acordo.periodos || []).filter(function (p) {
                                    var i = parseData(p.inicio), f = parseData(p.fim);
                                    return i && f && dia.data >= i && dia.data <= f;
                                })[0];
                                var extras = (periodoAcordo && periodoAcordo.minutosExtras) || 0;
                                var ent = PontoCalculos.timeToMinutes(r.entrada);
                                // `duracaoAlmoco` não existe no schema de regra — no original isto
                                // sempre caía em 60. Mantido para os números baterem.
                                if (ent !== null) conteudo = hhmm(ent + 60 + 480 + extras);
                            }
                        }
                    }

                    if (rowIndex <= 4) {
                        classes.push('ts-clickable');
                        if (!titulo) titulo = 'Clique para editar este dia';
                    }

                    if (rowIndex === 8 || rowIndex === 9) {
                        var calc = calcDia(dia.iso);
                        if (calc && calc.temRegistro) {
                            if (rowIndex === 8) {
                                conteudo = hhmm(calc.trabalhadas);
                                if (calc.status === 'extra') classes.push('saldo-positivo');
                                if (calc.status === 'falta') classes.push('saldo-negativo');
                            } else {
                                if (calc.saldo !== 0) {
                                    conteudo = hhmm(calc.saldo);
                                    if (calc.saldo > 0) { classes.push('saldo-positivo'); contadores.extras++; }
                                    else { classes.push('saldo-negativo'); contadores.faltas++; }
                                }
                                saldoMes += calc.saldo || 0;
                            }
                        } else if (calc && !calc.temRegistro && calc.saldo < 0) {
                            if (rowIndex === 9) {
                                conteudo = hhmm(calc.saldo);
                                classes.push('saldo-negativo');
                                contadores.faltas++;
                                saldoMes += calc.saldo;
                            }
                        }
                    }

                    if (dia.isHoje) classes.push('ts-dia-hoje');
                    var attrs = (classes.length ? ' class="' + classes.join(' ') + '"' : '') +
                                (titulo ? ' title="' + esc(titulo) + '"' : '') +
                                (rowIndex <= 6 ? ' data-ponto-action="timesheetEditarDia" data-valor="' + dia.iso + '"' : '');
                    cells.push('<td' + attrs + '>' + esc(conteudo) + '</td>');
                });
            })(rowIndex);
            /* eslint-enable no-loop-func */

            if (rowIndex === 0) {
                cells.push('<td rowspan="' + NUM_ROWS + '" class="col-saldo-acumulado">' +
                    '<div class="saldo-vertical-text"><span>Saldo Acumulado</span></div></td>');
            }

            var classeLinha = rowIndex === 5 ? ' class="row-separador-azul"' : (rowIndex === 2 ? ' class="row-duracao-almoco"' : '');
            linhas.push('<tr' + classeLinha + '>' + cells.join('') + '</tr>');
        }

        // ── Linha SALDO MÊS ──
        var acumulado = saldoAnterior + saldoMes;
        var clsSaldo = function (v) { return v > 0 ? ' saldo-positivo' : (v < 0 ? ' saldo-negativo' : ''); };

        linhas.push('<tr class="row-saldo-mes">' +
            '<td>SALDO MÊS</td>' +
            '<td class="col-saldo-anterior' + clsSaldo(saldoAnterior) + '">' + hhmm(saldoAnterior) + '</td>' +
            '<td colspan="' + dias.length + '" class="' + clsSaldo(saldoMes).trim() + '">' + hhmm(saldoMes) + '</td>' +
            '<td class="col-saldo-acumulado' + clsSaldo(acumulado) + '">' + hhmm(acumulado) + '</td>' +
        '</tr>');

        var html = '<div class="timesheet-mes" data-year="' + ano + '" data-month="' + mes + '">' +
            '<div class="timesheet-header">' + MES_NOMES[mes] + ' de ' + ano + '</div>' +
            '<div class="timesheet-wrapper"><table class="timesheet-table">' +
                '<thead>' + cabecalho + '</thead><tbody>' + linhas.join('') + '</tbody>' +
            '</table></div>' +
        '</div>';

        return { html: html, saldoMes: saldoMes };
    }

    // ──────────────────────────────────────────────
    //  API
    // ──────────────────────────────────────────────
    function renderizar(acordoIdx) {
        var acordos = PontoStore.listarAcordos();
        if (!acordos.length) {
            return '<div class="ponto-placeholder"><p>Nenhum acordo cadastrado — a folha de ponto é gerada a partir de um acordo de jornada.</p></div>';
        }

        if (acordoIdx == null || !acordos[acordoIdx]) acordoIdx = acordoPadrao();
        var acordo = acordos[acordoIdx];

        var seletor = '<div class="ponto-ts-toolbar"><label>Acordo: <select data-ponto-action="timesheetTrocarAcordo">' +
            acordosOrdenados().map(function (it) {
                return '<option value="' + it.i + '"' + (it.i === acordoIdx ? ' selected' : '') + '>' +
                    esc(it.a.nome || ('Acordo ' + (it.i + 1))) + '</option>';
            }).join('') +
        '</select></label></div>';

        if (!acordo.periodos || !acordo.periodos.length) {
            return seletor + '<div class="ponto-placeholder"><p>Acordo sem períodos de compensação.</p></div>';
        }

        var registros = PontoStore.listarRegistros();
        var mapaReg = {};
        registros.forEach(function (r) { mapaReg[r.data] = r; });

        var ctx = {
            registros: registros,
            eventos: PontoStore.listarEventos(),
            acordos: acordos,
            tiposEvento: PontoStore.listarTiposEvento(),
            periodosAquisitivos: PontoStore.listarPeriodosAquisitivos(),
            mapaReg: mapaReg
        };

        var janela = janelaFiscal(acordo);
        var inicio = janela.inicio, fim = janela.fim;

        // Saldo acumulado herdado de antes do ano fiscal exibido.
        var globalFirst = primeiraDataGlobal(ctx, acordo);
        var globalFirstYear = globalFirst ? globalFirst.getFullYear() : null;
        var globalFirstMonth = globalFirst ? globalFirst.getMonth() : null;

        var saldoAcumuladoGeral = 0;
        if (globalFirstYear !== null) {
            var ptr = new Date(globalFirstYear, globalFirstMonth, 1);
            var limite = new Date(inicio.getFullYear(), inicio.getMonth(), 0); // último dia do mês anterior
            while (ptr <= limite) {
                saldoAcumuladoGeral += somaMes(ctx, ptr.getFullYear(), ptr.getMonth());
                ptr.setMonth(ptr.getMonth() + 1);
            }
        }

        // Contadores do resumo e render mês a mês.
        var contadores = { extras: 0, faltas: 0, feriados: 0 };
        var partes = [];
        var cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
        var acumulado = saldoAcumuladoGeral;

        while (cursor <= fim) {
            var ano = cursor.getFullYear(), mes = cursor.getMonth();
            var ehPrimeiroMesGlobal = (globalFirstYear !== null)
                ? (ano === globalFirstYear && mes === globalFirstMonth)
                : (ano === inicio.getFullYear() && mes === inicio.getMonth());

            var saldoAnterior = ehPrimeiroMesGlobal ? 0 : acumulado;
            var res = renderMes(ctx, ano, mes, saldoAnterior, contadores);
            partes.push(res.html);
            acumulado = saldoAnterior + res.saldoMes;
            cursor.setMonth(cursor.getMonth() + 1);
        }

        var resumo = '<div class="ponto-ts-resumo">' +
            '<div><span>Dias com hora extra</span><strong>' + contadores.extras + '</strong></div>' +
            '<div><span>Dias com falta</span><strong>' + contadores.faltas + '</strong></div>' +
            '<div><span>Dias de feriado</span><strong>' + contadores.feriados + '</strong></div>' +
        '</div>';

        return seletor + partes.join('') + resumo;
    }

    window.PontoTimesheet = {
        renderizar: renderizar,
        acordoPadrao: acordoPadrao
    };
})();
