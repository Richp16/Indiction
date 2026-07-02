import NavBar from './NavBar';

export default function Layout({ children }) {
  return (
    <>
      <NavBar />
      <main className="app-main">{children}</main>
    </>
  );
}
