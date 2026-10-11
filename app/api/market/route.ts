import {NextResponse} from 'next/server';import{sampleCandles}from '../../../lib/data';
export async function GET(){return NextResponse.json({symbol:'DEMO',source:'SIMULATED',candles:sampleCandles()})}
