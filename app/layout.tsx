import "./globals.css";

export const metadata={title:"AI Office",description:"3D autonomous AI office simulator"};

export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="id"><body>{children}</body></html>;
}