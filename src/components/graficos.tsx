"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dataCurta, dinheiro, inteiro } from "@/lib/formato";

const FORMATOS = { dinheiro, inteiro };

type Ponto = { data: string } & Record<string, number | string | null>;

/** Barras diárias de uma métrica só (um eixo, uma série), com tooltip ao passar o mouse. */
export function BarrasDiarias({ dados, campo, titulo, formato, cor = "var(--serie-1)" }: {
  dados: Ponto[];
  campo: string;
  titulo: string;
  formato: keyof typeof FORMATOS;
  cor?: string;
}) {
  const formatar = (v: number) => FORMATOS[formato](v);
  return (
    <div className="rounded-xl border border-borda bg-superficie p-4">
      <div className="mb-3 text-sm font-medium">{titulo}</div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--borda)" />
            <XAxis
              dataKey="data" tickFormatter={dataCurta} tickLine={false} axisLine={false}
              tick={{ fill: "var(--texto-3)", fontSize: 11 }} minTickGap={16}
            />
            <YAxis
              tickFormatter={(v) => formatar(Number(v))} tickLine={false} axisLine={false} width={72}
              tick={{ fill: "var(--texto-3)", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: "var(--fundo)" }}
              formatter={(v) => [formatar(Number(v)), titulo]}
              labelFormatter={(l) => dataCurta(String(l))}
              contentStyle={{
                background: "var(--superficie)", border: "1px solid var(--borda)",
                borderRadius: 8, color: "var(--texto)", fontSize: 12,
              }}
            />
            <Bar dataKey={campo} fill={cor} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
