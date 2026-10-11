import{NextResponse}from'next/server';export async function GET(){return NextResponse.json({mode:'PAPER',startingBalance:10000,currency:'USD'})}
