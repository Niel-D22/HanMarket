import type { FC } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

interface PayoffChartProps {
  type: 'write' | 'buy';
  strike: number;
  premium: number;
  quantity: number;
}

export const PayoffChart: FC<PayoffChartProps> = ({ type, strike, premium, quantity }) => {
  // If inputs are invalid or 0, return placeholder
  if (strike <= 0 || premium <= 0 || quantity <= 0 || isNaN(strike) || isNaN(premium) || isNaN(quantity)) {
    return (
      <div style={{
        height: '250px',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px dashed rgba(11,11,11,0.1)',
        borderRadius: '8px',
        backgroundColor: 'rgba(11,11,11,0.03)',
        color: 'rgba(40,33,28,0.62)',
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        fontSize: '0.85rem'
      }}>
        ENTER VALID PARAMETERS TO SEE PAYOFF CHART
      </div>
    );
  }

  // Generate data points
  // X-axis: Underlying asset price at expiry
  // Y-axis: Profit / Loss
  
  const minPrice = Math.max(0, strike - (strike * 0.5));
  const maxPrice = strike + (strike * 0.5);
  const step = (maxPrice - minPrice) / 20;
  
  const data = [];
  
  for (let price = minPrice; price <= maxPrice; price += step) {
    let pnl = 0;
    
    if (type === 'write') {
      // Short Call payoff (Option leg only)
      pnl = (premium - Math.max(0, price - strike)) * quantity;
    } else {
      // Long Call payoff
      pnl = (Math.max(0, price - strike) - premium) * quantity;
    }
    
    data.push({
      price: parseFloat(price.toFixed(2)),
      pnl: parseFloat(pnl.toFixed(2))
    });
  }

  const formatUsd = (val: number) => `$${val.toFixed(2)}`;

  return (
    <div style={{ 
      padding: '1rem', 
      backgroundColor: 'rgba(11,11,11,0.03)', 
      borderRadius: '8px', 
      marginBottom: '1.5rem', 
      border: '1px dashed rgba(11,11,11,0.1)' 
    }}>
      <h3 style={{
        color: 'rgba(40,33,28,0.62)',
        fontSize: '0.75rem',
        marginBottom: '1rem',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        margin: '0 0 1rem 0'
      }}>
        Projected Payoff (PnL)
      </h3>
      <div style={{ width: '100%', height: 250 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(11,11,11,0.05)" />
            <XAxis 
              dataKey="price" 
              stroke="rgba(40,33,28,0.62)" 
              tick={{fill: 'rgba(40,33,28,0.62)', fontSize: 12, fontFamily: 'Space Mono'}}
              tickFormatter={(val) => `$${val}`}
            />
            <YAxis 
              stroke="rgba(40,33,28,0.62)" 
              tick={{fill: 'rgba(40,33,28,0.62)', fontSize: 12, fontFamily: 'Space Mono'}}
              tickFormatter={(val) => `$${val}`}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(11,11,11,0.1)', borderRadius: '4px', fontFamily: 'Space Mono' }}
              itemStyle={{ color: '#AB000D' }}
              formatter={(value: any) => [formatUsd(Number(value) || 0), 'PnL']}
              labelFormatter={(label) => `Asset Price: ${formatUsd(Number(label))}`}
            />
            <ReferenceLine y={0} stroke="rgba(11,11,11,0.2)" strokeDasharray="3 3" />
            <ReferenceLine x={strike} stroke="rgba(171,0,13, 0.5)" strokeDasharray="3 3" label={{ position: 'top', value: 'Strike', fill: '#AB000D', fontSize: 10, fontFamily: 'Space Mono' }} />
            <Line 
              type="monotone" 
              dataKey="pnl" 
              stroke="#AB000D" 
              strokeWidth={2} 
              dot={false}
              activeDot={{ r: 6, fill: '#AB000D' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
