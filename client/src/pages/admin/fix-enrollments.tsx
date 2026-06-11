import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { getAuth } from "firebase/auth";

export function FixEnrollments() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const { toast } = useToast();

  const handleFix = async () => {
    try {
      setLoading(true);
      
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      
      const response = await fetch('/api/admin/fix-enrollments', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setResult(data);
        toast({
          title: "Sucesso!",
          description: data.message
        });
      } else {
        throw new Error(data.error || 'Erro ao criar enrollments');
      }
    } catch (error: any) {
      console.error('Erro:', error);
      toast({
        variant: "destructive",
        title: "Erro",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Fix Enrollments</CardTitle>
          <CardDescription>
            Criar enrollments para todas as orders completadas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={handleFix}
            disabled={loading}
            className="w-full"
          >
            {loading ? 'Processando...' : 'Criar Enrollments'}
          </Button>
          
          {result && (
            <div className="mt-4 p-4 bg-blue-50 dark:bg-green-900/20 rounded">
              <p className="font-bold">Resultado:</p>
              <p>Criados: {result.created}</p>
              <p>Pulados: {result.skipped}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default FixEnrollments;
